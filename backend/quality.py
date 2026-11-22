"""Finish and inspect Auto Bash templates without changing their UV geometry."""

from functools import lru_cache
from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from .fabric_pattern import pattern_fill
from .photos import COLOR_PROFILE
from .placement import FACES, LIMBS, RULES, SIDES, FabricPatches

SHADING = Path(__file__).resolve().parents[1] / "frontend" / "public" / "shading"
BACK_GUESS = "We guessed the back from nearby fabric."
WORN_DETAIL = "Parts of the person or background may still show here."
UNCLEAR_EDGE = "This edge may show a join."


def rgba(png: bytes) -> np.ndarray:
    with Image.open(BytesIO(png)) as source:
        return np.array(source.convert("RGBA"))


def face_view(image: np.ndarray, part: str, face: str) -> np.ndarray:
    x, y, w, h = FACES[part, face]
    return image[y:y + h, x:x + w]


@lru_cache(maxsize=4)
def art(name: str) -> np.ndarray:
    with Image.open(SHADING / f"{name}.png") as image:
        return np.asarray(image.convert("RGBA"), dtype=np.float32) / 255


def tint_art(face: np.ndarray, layer: np.ndarray, strength: float) -> None:
    """Use the artwork as multiply shadows and gentle fabric-tinted highlights."""
    rgb = face[..., :3].astype(np.float32)
    signed = (layer[..., :1] * 2 - 1) * layer[..., 3:4] * strength
    signed = np.where(face[..., 3:4] > 0, signed, 0)
    shadow = np.minimum(signed, 0)
    light = np.maximum(signed, 0)
    face[..., :3] = np.rint(np.clip(rgb * (1 + shadow) + np.sqrt(rgb * 255) * light, 0, 255)).astype(np.uint8)


def pants_back(template: np.ndarray, donor: str, phase: int, pockets: bool) -> np.ndarray:
    """Use photographed thigh fabric and keep its joins next to the waist sides."""
    material = face_view(template, donor, "front")
    covered = np.flatnonzero((material[..., 3] >= 250).any(axis=1))
    if len(covered):
        end = covered[-1] + 1
        material = material[end // 5:end * 4 // 5, 10:-10].copy()
    opaque = material[..., 3] >= 250
    candidate = template.copy()
    back = face_view(candidate, "torso", "back")
    left_join = face_view(candidate, "torso", "left")[:, -1]
    right_join = face_view(candidate, "torso", "right")[:, 0]
    # Keep the color in the existing waistband and cuffs. The source swatch
    # supplies cloth texture and creates a second candidate from the other leg.
    seed = np.zeros_like(back)
    seed[:, 0], seed[:, -1] = left_join, right_join
    tile = pattern_fill(material, back.shape[:2], phase, seed) if opaque.all() else None
    if tile is None:
        back[:] = FabricPatches(material if opaque.any() else face_view(template, "torso", "front")).fill(seed)
    else:
        back[:] = tile
        back[:, 0], back[:, -1] = left_join, right_join
    # Copy the true waistband from facing side edges, with a gradual color
    # match across the generated area. The inner cloth remains real texture.
    centers = np.median(back[:, 5:-5, :3], axis=1)
    join_colors = (left_join[:, :3].astype(float) + right_join[:, :3]) / 2
    offset = cv2.GaussianBlur((join_colors - centers).astype(np.float32), (1, 15), 3)
    strength = np.linspace(0, 1, back.shape[1])
    strength = np.minimum(1, np.minimum(strength, 1 - strength) * 10)[None, :, None]
    back[..., :3] = np.rint(np.clip(back[..., :3] + strength * offset[:, None].clip(-24, 24), 0, 255))
    if pockets:
        tint_art(back, art("denim-pockets"), 0.86)
    return candidate


def fill_unseen(png: bytes, mode: str, profile: str, has_back: bool) -> list[np.ndarray]:
    image = rgba(png)
    if mode != "pants" or has_back:
        return [image]
    band = face_view(image, "torso", "back")
    if band[..., 3].any():
        return [image]
    fabric = face_view(image, "torso", "front")[44:108]
    hue, saturation, _ = cv2.split(cv2.cvtColor(fabric[..., :3], cv2.COLOR_RGB2HSV))
    is_denim = profile == "pants" and ((hue >= 88) & (hue <= 125) & (saturation > 42)).mean() > 0.6
    return [pants_back(image, limb, phase, is_denim) for phase, limb in enumerate(LIMBS)]


def seams(image: np.ndarray):
    for part in ("torso", *LIMBS):
        for index, side in enumerate(SIDES):
            other = SIDES[(index + 1) % len(SIDES)]
            yield (part, side), (part, other), face_view(image, part, side)[:, -4:], face_view(image, part, other)[:, :4][:, ::-1]
        front = face_view(image, part, "front")
        up = face_view(image, part, "up")
        down = face_view(image, part, "down")
        # Coordinate v of each returned strip increases toward the physical join.
        yield (part, "front"), (part, "up"), front[:4][::-1].transpose(1, 0, 2), up[-4:].transpose(1, 0, 2)
        yield (part, "front"), (part, "down"), front[-4:].transpose(1, 0, 2), down[:4][::-1].transpose(1, 0, 2)


def blend_seams(image: np.ndarray) -> None:
    ramp = np.float32([0.04, 0.11, 0.23, 0.5])[None, :, None]
    for _, _, first, second in seams(image):
        a, b = first[..., :3].astype(np.float32), second[..., :3].astype(np.float32)
        overlap = ((first[..., 3] >= 250) & (second[..., 3] >= 250))[..., None]
        adjust = ((b - a) * ramp).clip(-25, 25) * overlap
        first[..., :3], second[..., :3] = np.rint(a + adjust), np.rint(b - adjust)


def correct_color(rgb: np.ndarray) -> np.ndarray:
    """Estimate mild color cast only from bright, nearly neutral image corners."""
    h, w = rgb.shape[:2]
    d = max(1, min(h, w) // 10)
    corners = np.stack([rgb[y:y + d, x:x + d, :3]
                        for y, x in ((0, 0), (0, w - d), (h - d, 0), (h - d, w - d))])
    matte = np.median(corners, axis=(1, 2))
    neutral = matte[(matte.min(axis=1) >= 120) & (np.ptp(matte, axis=1) <= 19)]
    if len(neutral) < 3:
        return np.ones(3)
    light = np.median(neutral, axis=0)
    return np.clip(light.mean() / light, 0.96, 1.04)


def finish_images(images: list[np.ndarray], mode: str, profile: str, shading: float,
                  original: Image.Image) -> None:
    gains = correct_color(np.asarray(original))
    for image in images:
        rgb = image[..., :3].astype(np.float32)
        opaque = (image[..., 3] >= 250).astype(np.float32)[..., None]
        support = cv2.GaussianBlur(opaque[..., 0], (3, 3), 0.6)[..., None]
        soft = cv2.GaussianBlur(rgb * opaque, (3, 3), 0.6) / np.maximum(support, 0.0001)
        # Bound the enhancement so compression noise does not dominate real stitching.
        detail = np.clip((rgb - soft) * 0.18, -4, 4) * opaque
        image[..., :3] = np.where(opaque > 0, np.rint(np.clip(rgb * gains + detail, 0, 255)), rgb)
        if mode == "pants" and profile != "skirt" and shading > 0:
            for side in ("front", "back"):
                tint_art(face_view(image, "torso", side), art("pants-waist"), 0.68 * shading)
            height = round(128 * RULES["profiles"][profile]["limb_height"])
            for limb in LIMBS:
                for side in SIDES:
                    tint_art(face_view(image, limb, side)[:height], art(f"{profile}-leg"), 0.62 * shading)
        if mode != "t-shirt":
            blend_seams(image)


def inspect_quality(image: np.ndarray, mode: str, profile: str, photo_type: str,
                    has_back: bool, source_range: np.ndarray | None = None) -> tuple[dict, float]:
    worn = photo_type == "worn"
    if mode == "t-shirt":
        coverage = float((image[..., 3] > 0).mean())
        score = round(60 + 35 * coverage - (20 if worn else 0))
        front = {"score": score, **({"note": WORN_DETAIL} if worn else {})}
        return {"score": score, "regions": {"torso.front": front}}, 0

    mismatch: dict[tuple[str, str], list[float]] = {key: [] for key in FACES}
    for a, b, first, second in seams(image):
        both = (first[:, -1, 3] >= 250) & (second[:, -1, 3] >= 250)
        if both.sum() < len(both) / 5:
            continue
        # Include the inner strips so a hard transition just inside the edge
        # cannot earn a perfect join just because its final pixel was matched.
        delta = float(np.abs(first[both, :, :3].astype(float) - second[both, :, :3]).mean())
        mismatch[a].append(delta)
        mismatch[b].append(delta)
    notes = {}
    limb_fraction = RULES["profiles"][profile]["limb_height"]
    for (part, face), gaps in mismatch.items():
        current = face_view(image, part, face)
        limb = part in LIMBS
        if limb and (limb_fraction == 0 or (limb_fraction < 1 and face == "down")):
            continue
        expected = 0.77 if part == "torso" and face == "up" and mode == "shirt" else 1
        if limb and face in SIDES:
            expected = limb_fraction
        coverage = min(1., float((current[..., 3] > 200).mean()) / expected)
        gap = float(np.mean(gaps)) if gaps else 0
        fabric = current[::3, ::3]
        colors = fabric[fabric[..., 3] > 200, :3]
        difference = 0.
        if source_range is not None and len(colors):
            difference = float(((colors < source_range[0] - 16) |
                                (colors > source_range[1] + 16)).any(axis=1).mean())
        score = round(95 - 45 * (1 - coverage) - min(gap, 30) - difference * 12 - (27 if worn else 0))
        score = max(0, score)
        reason = None
        inferred_back = not has_back or (mode == "shirt" and part in LIMBS)
        if inferred_back and face == "back":
            score = min(score, 56)
            reason = BACK_GUESS
        elif coverage < 0.82:
            reason = "Some fabric could not be placed here."
        elif worn:
            reason = WORN_DETAIL
        elif gap > 17:
            reason = UNCLEAR_EDGE
        elif difference > 0.35:
            reason = "The color here may differ from the photographed fabric."
        notes[f"{part}.{face}"] = {"score": score, **({"note": reason} if reason else {})}
    values = [region["score"] for region in notes.values()]
    measured = [gap for scores in mismatch.values() for gap in scores]
    return {"score": round(float(np.mean(values))), "regions": notes}, float(np.mean(measured)) if measured else 0


def review_templates(images: list[np.ndarray], mode: str, profile: str, photo_type: str,
                     has_back: bool, cutout_png: bytes) -> list[tuple[bytes, dict]]:
    source = rgba(cutout_png)[::3, ::3]
    cloth = source[source[..., 3] > 200, :3]
    source_range = np.percentile(cloth, [5, 95], axis=0) if len(cloth) else None
    judged = [(image, *inspect_quality(image, mode, profile, photo_type, has_back, source_range))
              for image in images]
    judged.sort(key=lambda item: (-item[1]["score"], item[2]))
    results = []
    for image, quality, _ in judged:
        output = BytesIO()
        Image.fromarray(image).save(output, format="PNG", icc_profile=COLOR_PROFILE.tobytes())
        results.append((output.getvalue(), quality))
    return results
