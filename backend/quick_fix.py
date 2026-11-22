"""Reversible adjustments to an Auto Bash result at its original UV size."""

from base64 import b64decode, b64encode
from binascii import Error as Base64Error
from io import BytesIO
from typing import Annotated, Literal

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException, Request
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError
from starlette.concurrency import run_in_threadpool

from autobash_core.autobash import clone_fill, graphic_mask

from .photos import COLOR_PROFILE
from .placement import CLASSIC_SIZE, FACES, LIMBS, SIDES, TSHIRT_SIZE, FabricPatches
from .quality import face_view

router = APIRouter()
MAX_EDIT_BYTES = 2_000_000
HexColor = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]
Adjustment = Annotated[int, Field(ge=-100, le=100)]


class ColorSwap(BaseModel):
    source: HexColor
    target: HexColor


class Fixes(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sharpness: Adjustment = 0
    brightness: Adjustment = 0
    saturation: Adjustment = 0
    color: ColorSwap | None = None
    remove_logo: bool = False
    plain_back: bool = False
    back_version: Annotated[int, Field(ge=0, le=1000)] = 0
    sleeves: Literal["auto", "short", "long", "none"] = "auto"
    style: Literal["realistic", "clean", "cartoon", "vintage", "grunge"] = "realistic"


class FixRequest(BaseModel):
    png: Annotated[str, Field(max_length=MAX_EDIT_BYTES)]
    mode: Literal["shirt", "pants", "t-shirt"]
    fixes: Fixes


def remove_graphic(face: np.ndarray) -> None:
    fabric = face[..., 3] > 240
    if not fabric.any():
        return
    rgb = np.ascontiguousarray(face[..., :3])
    print_mask = graphic_mask(rgb, fabric)
    if print_mask.any() and (fabric & ~print_mask).sum() > 80:
        face[..., :3] = clone_fill(rgb, print_mask, fabric)


def tile_back(image: np.ndarray, variant: int, plain: bool) -> None:
    back = face_view(image, "torso", "back")
    sides = [face_view(image, "torso", side) for side in ("right", "left")]
    source = sides[variant % len(sides)]
    # The lower sides are less likely to carry front lettering or collar detail.
    material = source[52:112, 6:-6].copy()
    if not (material[..., 3] == 255).any():
        material = face_view(image, "torso", "front")[64:116].copy()
    if not (material[..., 3] == 255).any():
        return
    if plain:
        # Keep some real grain from a quiet part of the cloth. Prefer the
        # lowest-contrast rectangular tile instead of blurring a print.
        patches = FabricPatches(material, spacing=18)
        chip = patches.patches[patches.texture_cost.argmin()]
        rows = np.arange(back.shape[0]) % len(chip)
        cols = np.arange(back.shape[1]) % chip.shape[1]
        back[..., :3] = chip[rows[:, None], cols]
        back[..., 3] = 255
        return

    seed = np.zeros_like(back)
    seed[:, 0] = sides[1][:, -1]
    seed[:, -1] = sides[0][:, 0]
    # Alternate photographed sides and seed phases without stretching fabric.
    if (variant // 2) % 2:
        material = material[:, ::-1]
    back[:] = FabricPatches(material, spacing=(20, 25, 29)[(variant // 4) % 3]).fill(seed)


def change_sleeves(image: np.ndarray, choice: str) -> None:
    if choice == "auto":
        return
    for arm in LIMBS:
        down = face_view(image, arm, "down")
        if choice == "none":
            for side in (*SIDES, "up", "down"):
                face_view(image, arm, side)[:] = 0
            continue
        front = face_view(image, arm, "front")
        donor = front[:52].copy()
        if not (donor[..., 3] == 255).any():
            donor = face_view(image, "torso", "front")[56:108, :64].copy()
        if not (donor[..., 3] == 255).any():
            continue
        patches = FabricPatches(donor)
        for side in SIDES:
            face = face_view(image, arm, side)
            if choice == "short":
                face[52:] = 0
                face = face[:52]
            if (face[..., 3] < 255).any():
                face[:] = patches.fill(face)
        up = face_view(image, arm, "up")
        if (up[..., 3] < 255).any():
            up[:] = patches.fill(up)
        if choice == "short":
            down[:] = 0
        elif (down[..., 3] < 255).any():
            down[:] = FabricPatches(front[-52:]).fill(down)


def swap_colors(rgb: np.ndarray, swap: ColorSwap) -> np.ndarray:
    def color(hex_code: str) -> np.ndarray:
        return np.array([int(hex_code[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32)

    source, target = color(swap.source), color(swap.target)
    weights = np.float32([0.2126, 0.7152, 0.0722])
    light = rgb @ weights
    source_light = source @ weights
    chroma = rgb - light[..., None]
    source_chroma = source - source_light
    # A soft selection around the picked swatch preserves folds and edges.
    distance = np.linalg.norm(chroma - source_chroma, axis=2) + 0.56 * np.abs(light - source_light)
    selection = np.clip((64 - distance) / 37, 0, 1)[..., None]
    shifted = target + (light - source_light)[..., None]
    return rgb + (shifted - rgb) * selection


def adjust_tone(image: np.ndarray, fixes: Fixes) -> None:
    rgb = image[..., :3].astype(np.float32)
    coverage = image[..., 3].astype(np.float32) / 255
    if fixes.color:
        rgb = swap_colors(rgb, fixes.color)
    if fixes.sharpness or fixes.style == "clean":
        alpha = coverage[..., None]
        support = cv2.GaussianBlur(coverage, (5, 5), 0.9)[..., None]
        soft = cv2.GaussianBlur(rgb * alpha, (5, 5), 0.9) / np.maximum(support, 0.001)
        amount = fixes.sharpness / 100 - (0.28 if fixes.style == "clean" else 0)
        rgb += np.clip((rgb - soft) * amount, -36, 36)
    gray = rgb @ np.float32([0.2126, 0.7152, 0.0722])
    saturation = fixes.saturation / 100
    if fixes.style == "vintage":
        saturation -= 0.28
    rgb += (rgb - gray[..., None]) * saturation
    rgb *= 1 + fixes.brightness * 0.005
    if fixes.style == "cartoon":
        rgb = np.rint(rgb / 32) * 32
    elif fixes.style == "vintage":
        rgb = rgb * 0.88 + [22, 14, 5]
    elif fixes.style == "grunge":
        grain = np.random.default_rng(2026).normal(0, 11, coverage.shape)
        rgb = rgb * 0.83 + grain[..., None]
    image[..., :3] = np.where(coverage[..., None] > 0, np.rint(np.clip(rgb, 0, 255)), 0)


def edit_png(job: FixRequest) -> str:
    dimensions = TSHIRT_SIZE if job.mode == "t-shirt" else CLASSIC_SIZE
    try:
        data = b64decode(job.png, validate=True)
        with Image.open(BytesIO(data), formats=["PNG"]) as source:
            if source.size != dimensions:
                raise ValueError("Wrong template dimensions.")
            image = np.array(source.convert("RGBA"))
    except (Base64Error, UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(422, "Upload an Auto Bash PNG at the correct size.") from exc
    if job.fixes.remove_logo:
        remove_graphic(image if job.mode == "t-shirt" else face_view(image, "torso", "front"))
    if job.mode != "t-shirt" and (job.fixes.plain_back or job.fixes.back_version):
        tile_back(image, job.fixes.back_version, job.fixes.plain_back)
    if job.mode == "shirt":
        change_sleeves(image, job.fixes.sleeves)
    adjust_tone(image, job.fixes)
    if job.mode != "t-shirt":
        valid = np.zeros(image.shape[:2], dtype=bool)
        for x, y, w, h in FACES.values():
            valid[y:y + h, x:x + w] = True
        image[~valid] = 0
    out = BytesIO()
    Image.fromarray(image).save(out, format="PNG", icc_profile=COLOR_PROFILE.tobytes())
    return b64encode(out.getvalue()).decode("ascii")


@router.post("/quick-fix")
async def quick_fix(request: Request):
    payload = bytearray()
    async for chunk in request.stream():
        if len(payload) + len(chunk) > MAX_EDIT_BYTES:
            raise HTTPException(413, "This template is too large to edit.")
        payload.extend(chunk)
    try:
        job = FixRequest.model_validate_json(payload)
    except ValidationError as exc:
        raise HTTPException(422, "Choose supported Quick-Fix settings and try again.") from exc
    return {"png": await run_in_threadpool(edit_png, job)}
