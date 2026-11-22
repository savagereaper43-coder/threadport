"""Photobash real fabric into the shared Roblox UV rectangles."""

import json
import math
from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from .fabric_pattern import pattern_fill
from .garment_parts import GarmentParts, Piece
from .photos import COLOR_PROFILE, PhotoError

SHARED = Path(__file__).resolve().parents[1] / "shared"
REGIONS = json.loads((SHARED / "templateLayout.json").read_text(encoding="utf-8"))
RULES = json.loads((SHARED / "placement_rules.json").read_text(encoding="utf-8"))
FACES = {(r["part"], r["face"]): (r["x"], r["y"], r["w"], r["h"]) for r in REGIONS}
CLASSIC_SIZE = (585, 559)
TSHIRT_SIZE = (512, 512)
SIDES = ("right", "front", "left", "back")
LIMBS = ("rightLimb", "leftLimb")


def photograph(photo: np.ndarray, axes: np.ndarray, scale: float,
               origin: tuple[float, float], size: tuple[int, int]) -> np.ndarray:
    """Rasterize with a similarity transform. All patching after this uses pixel copies."""
    transform = np.column_stack((axes * scale, origin))
    sampled = cv2.warpAffine(photo, transform, size, flags=cv2.INTER_LINEAR)
    # Keep only samples supported by opaque fabric, free of partly transparent edges.
    opaque = sampled[..., 3] >= 254
    sampled[~opaque] = 0
    sampled[..., 3][opaque] = 255
    return sampled


def projected_piece(photo: np.ndarray, piece: Piece, scale: float) -> np.ndarray:
    minimum, maximum = piece.bounds()
    size = tuple(np.floor((maximum - minimum) * scale + 1.000001).astype(int))
    return photograph(np.where(piece.mask[..., None], photo, 0),
                      piece.axes(), scale, tuple(-minimum * scale), size)


def layer(src: np.ndarray, width: int, height: int, x: int, y: int) -> np.ndarray:
    """Clip a translated layer to the destination without resampling it."""
    canvas = np.zeros((height, width, 4), dtype=np.uint8)
    left, top = max(x, 0), max(y, 0)
    right, bottom = min(x + src.shape[1], width), min(y + src.shape[0], height)
    if left < right and top < bottom:
        canvas[top:bottom, left:right] = src[top - y:bottom - y, left - x:right - x]
    return canvas


def body_scale(parts: GarmentParts, width: int, height: int) -> float:
    left, top, right, bottom = parts.body
    vertical = height / (bottom - top + 1)
    # A tall, narrow torso can extend into the caps. Limit the overhang
    # so the chest remains on the front face.
    return min(max(width / (right - left + 1), vertical), vertical * 1.48)


def limb_scale(parts: GarmentParts, base_scale: float, height: int, *, full_length: bool) -> float:
    lengths = []
    for limb in LIMBS:
        if limb in parts.pieces:
            lo, hi = parts.pieces[limb].bounds()
            lengths.append(hi[1] - lo[1] + 1)
    return height / max(lengths) if full_length and lengths else base_scale


def minimum_cut(cost: np.ndarray) -> np.ndarray:
    """Find a low-contrast path through an overlap, one coordinate per row."""
    height, width = cost.shape
    total = cost[0].copy()
    parents = np.zeros((height, width), dtype=np.int8)
    for y in range(1, height):
        padded = np.pad(total, 1, constant_values=np.inf)
        options = np.stack((padded[:-2], padded[1:-1], padded[2:]))
        parents[y] = options.argmin(axis=0) - 1
        total = cost[y] + options.min(axis=0)
    route = np.empty(height, dtype=int)
    route[-1] = int(total.argmin())
    for y in range(height - 1, 0, -1):
        route[y - 1] = route[y] + parents[y, route[y]]
    return route


def stitch(tile: np.ndarray, patch: np.ndarray, photo: np.ndarray, known: np.ndarray,
           overlap: int, from_right: bool, *, top_overlap: bool) -> None:
    height, width = known.shape
    replace = ~known
    error = np.abs(tile[..., :3].astype(np.float32) - patch).mean(axis=2)
    # Cut through similar colors in already cloned material. Original
    # photographed pixels remain fixed even where the overlap crosses them.
    border_w = min(overlap, width - 1)
    if border_w > 1:
        side = slice(-border_w, None) if from_right else slice(0, border_w)
        edge = error[:, side]
        if from_right:
            edge = edge[:, ::-1]
        cut = np.arange(border_w) >= minimum_cut(edge)[:, None]
        replace[:, side] |= cut[:, ::-1] if from_right else cut
    border_h = min(overlap, height - 1)
    if top_overlap and border_h > 1:
        cut = np.arange(border_h)[:, None] >= minimum_cut(error[:border_h].T)
        replace[:border_h] |= cut
    replace &= ~photo
    tile[replace, :3] = patch[replace]
    tile[replace, 3] = 255


class FabricPatches:
    """Choose opaque source patches and translate them into uncovered pixels."""

    def __init__(self, source: np.ndarray, spacing: int = 25):
        opaque = (source[..., 3] == 255).astype(np.uint8)
        self.pattern_source = source if opaque.all() else None
        integral = cv2.integral(opaque)
        for side in range(min(spacing, *opaque.shape), 0, -1):
            area = integral[side:, side:] - integral[:-side, side:] - integral[side:, :-side] + integral[:-side, :-side]
            rows, cols = np.nonzero(area == side * side)
            if len(rows):
                break
        else:
            raise PhotoError("We couldn't find enough fabric. Try a clear photo of the whole garment.")

        indices = np.linspace(0, len(rows) - 1, min(240, len(rows)), dtype=int)
        self.rows = rows[indices] + side / 2
        self.height = source.shape[0]
        self.side = side
        self.patches = np.stack([
            source[y:y + side, x:x + side, :3] for y, x in zip(rows[indices], cols[indices])
        ])
        self.patches = np.concatenate((self.patches, self.patches[:, :, ::-1]), axis=0)
        self.rows = np.tile(self.rows, 2)
        self.colors = self.patches.astype(np.float32)
        flat = self.colors.reshape(len(self.patches), -1, 3)
        self.medians = np.median(flat, axis=1)
        self.median = np.median(source[opaque.astype(bool), :3], axis=0)
        # Prefer fabric over unusually high-contrast details for replacement pixels.
        self.texture_cost = np.abs(flat - self.medians[:, None]).mean(axis=(1, 2)) * 0.35

    def fill(self, seed: np.ndarray, *, follow_length: bool = False) -> np.ndarray:
        result = seed.copy()
        height, width = result.shape[:2]
        if self.pattern_source is not None:
            tiled = pattern_fill(self.pattern_source, (height, width), 0, seed)
            if tiled is not None:
                empty = result[..., 3] == 0
                result[empty] = tiled[empty]
                return result
        side = self.side
        stride = max(1, side * 2 // 3)
        uses = np.zeros(len(self.patches), dtype=np.float32)
        # Start next to the photographed fabric and work outward.
        ys, xs = np.nonzero(seed[..., 3])
        center = float(np.median(xs)) if len(xs) else width / 2
        def positions(dimension: int) -> list[int]:
            last = max(0, dimension - side)
            return [*range(0, last, stride), last]

        columns = sorted(positions(width), key=lambda x: abs(x + side / 2 - center))
        for y in positions(height):
            for x in columns:
                tile = result[y:y + side, x:x + side]
                known = tile[..., 3] == 255
                if known.all():
                    continue
                ph, pw = known.shape
                cost = np.abs(self.medians - self.median).mean(axis=1) * 0.13
                cost += self.texture_cost + uses * 3
                if known.any():
                    candidates = self.colors[:, :ph, :pw]
                    cost += np.abs(candidates[:, known] - tile[..., :3][known]).mean(axis=(1, 2))
                if follow_length:
                    source_row = (y + ph / 2) / height * self.height
                    cost += np.abs(self.rows - source_row) / self.height * 36
                selected = cost.argmin()
                uses[selected] += 1
                uses[(selected + len(uses) // 2) % len(uses)] += 0.5
                rgb = self.patches[selected, :ph, :pw]
                protected = seed[y:y + side, x:x + side, 3] == 255
                stitch(tile, rgb, protected, known, side - stride, x + side / 2 < center,
                       top_overlap=y > 0)
        return result


def body_layer(parts: GarmentParts, scale: float, width: int, height: int,
               front_offset: int, front_height: int) -> np.ndarray:
    left, top, right, bottom = parts.body
    # Transform the entire cut-out once. The five torso faces are windows
    # into this layer, including overhang from the sleeves, shoulders and hem.
    photo = parts.photo
    y = front_offset
    if parts.profile in ("pants", "shorts"):
        photo = photo[:bottom + 1].copy()
        photo[:top] = 0
    y += (front_height - (bottom - top + 1) * scale) / 2
    return photograph(photo, np.eye(2), scale,
                      ((width - 1) / 2 - (left + right) / 2 * scale, y - top * scale),
                      (width, height))


def body_material(parts: GarmentParts, scale: float, size: tuple[int, int]) -> np.ndarray:
    left, top, right, bottom = parts.body
    width, height = size
    material = photograph(parts.photo, np.eye(2), scale,
                          (-left * scale, -top * scale),
                          (min(width, math.ceil((right - left + 1) * scale)),
                           min(height, math.ceil((bottom - top + 1) * scale))))
    return material


def clone_cap(source: np.ndarray, boundary: np.ndarray, size: tuple[int, int], bottom: bool,
              overhang: np.ndarray | None = None) -> np.ndarray:
    width, height = size
    band = max(1, math.ceil(source.shape[0] * 0.22))
    rows = source[-band:][::-1] if bottom else source[:band][::-1]
    seed_y = 0 if bottom else height - len(rows)
    seed = layer(rows, width, height, (width - rows.shape[1]) // 2, seed_y)
    seam = 0 if bottom else -1
    if overhang is not None:
        valid = overhang[..., 3] == 255
        seed[valid] = overhang[valid]
    seed[seam] = boundary
    return FabricPatches(source).fill(seed)


def clone_along_limb(seed: np.ndarray, source: np.ndarray, y: int, phase: int) -> np.ndarray:
    """Cover spare width with a translated strip running the length of the limb."""
    height, width = seed.shape[:2]
    opacity = source[..., 3] == 255
    counts = opacity.sum(axis=1)
    # The central strip keeps the photographed knee, folds and cuff at their
    # original heights on all four faces, even where more width is needed.
    strip_width = min(width, max(1, round(np.percentile(counts, 65) * 0.70)))
    center_columns = opacity.sum(axis=0)
    weights = np.convolve(center_columns, np.ones(strip_width), "valid")
    start = int(weights.argmax())
    strip = source[:, start:start + strip_width]
    pool = np.concatenate((strip, strip[:, ::-1]), axis=1)
    columns = (np.arange(width) + phase) % pool.shape[1]
    lining = layer(pool[:, columns], width, height, 0, y)
    fill = (seed[..., 3] == 0) & (lining[..., 3] == 255)
    seed[fill] = lining[fill]
    return seed


def limb_faces(front: np.ndarray, reverse: np.ndarray | None, width: int, height: int) -> dict[str, np.ndarray]:
    size = width, height
    fw = front.shape[1]
    side = max(1, math.ceil(fw * 0.38))
    # Cuts run along the complete photographed limb. Rotate only the source
    # as a whole, then move or mirror these strips without changing their scale.
    sources = {
        "front": front,
        "right": front[:, :side][:, ::-1],
        "left": front[:, -side:][:, ::-1],
        "back": reverse if reverse is not None else front[:, fw // 4:fw - fw // 4][:, ::-1],
    }
    faces = {}
    front_patches = FabricPatches(front)
    for index, (name, source) in enumerate(sources.items()):
        x = {"right": width - source.shape[1], "left": 0}.get(name, (width - source.shape[1]) // 2)
        y = (height - source.shape[0]) // 2
        patch_source = reverse if name == "back" and reverse is not None else front
        seed = layer(source, width, height, x, y)
        seed = clone_along_limb(seed, patch_source, y, phase=index * 7)
        patches = front_patches if patch_source is front else FabricPatches(patch_source)
        faces[name] = patches.fill(seed, follow_length=True)
    # Anchor each UV join to the same boundary texels. The interiors are
    # translations of photographed cloth, with no gradient or warp.
    faces["right"][:, -1] = faces["front"][:, 0]
    faces["left"][:, 0] = faces["front"][:, -1]
    faces["right"][:, 0] = faces["back"][:, -1]
    faces["left"][:, -1] = faces["back"][:, 0]
    return faces


def place_template(mode: str, front: GarmentParts, back: GarmentParts | None = None) -> bytes:
    if mode == "t-shirt":
        width, height = TSHIRT_SIZE
        left, top, right, bottom = front.body
        scale = min(width / (right - left + 1), height / (bottom - top + 1))
        canvas = photograph(front.photo, np.eye(2), scale,
                            ((width - 1) / 2 - (left + right) / 2 * scale, -top * scale), TSHIRT_SIZE)
    else:
        canvas = np.zeros((CLASSIC_SIZE[1], CLASSIC_SIZE[0], 4), dtype=np.uint8)
        profile = RULES["profiles"][front.profile]
        limb_height = round(FACES["rightLimb", "front"][3] * profile["limb_height"])
        side_width = FACES["torso", "right"][2]
        _, _, body_width, body_height = FACES["torso", "front"]
        full_sleeve = profile["limb_height"] == 1
        complete_limb = full_sleeve or profile["mode"] == "pants"
        scale = body_scale(front, body_width, body_height)
        front_limb_scale = limb_scale(front, scale, limb_height, full_length=complete_limb)
        back_scale = body_scale(back, body_width, body_height) if back else None
        back_limb_scale = limb_scale(back, back_scale, limb_height, full_length=complete_limb) if back else None

        def put(part: str, face: str, texture: np.ndarray) -> None:
            x, y, w, h = FACES[part, face]
            height, width = texture.shape[:2]
            assert width == w and height <= h
            canvas[y:y + height, x:x + width] = texture

        material = body_material(front, scale, (body_width, body_height))
        # The lower torso provides neutral fabric for cloning around edges and
        # below a short waistband while keeping logos and pockets on the photo.
        plain = material[material.shape[0] // 2:].copy()
        if profile["mode"] == "pants":
            # Keep the fly out of cloned fabric. Its photographed pixels stay
            # in the front layer exactly where they landed.
            mid = plain.shape[1] // 2
            margin = max(1, plain.shape[1] // 6)
            plain[:, mid - margin:mid + margin] = 0
        swatches = plain if plain[..., 3].any() else material
        cap_height = FACES["torso", "up"][3]
        cross = body_layer(front, scale, body_width + side_width * 2,
                           body_height + cap_height * 2, cap_height, body_height)
        band_seed = cross[cap_height:cap_height + body_height]
        band = FabricPatches(swatches).fill(band_seed)
        body_front = band[:, side_width:side_width + body_width]
        put("torso", "right", band[:, :side_width])
        put("torso", "front", body_front)
        put("torso", "left", band[:, side_width + body_width:])
        if back:
            back_material = body_material(back, back_scale, (body_width, body_height))
            rear = body_layer(back, back_scale, body_width, body_height, 0, body_height)
            put("torso", "back", FabricPatches(back_material).fill(rear))

        for face in ("up", "down"):
            bottom = face == "down"
            cap_size = FACES["torso", face][2:]
            rows = slice(cap_height + body_height, None) if bottom else slice(0, cap_height)
            overhang = cross[rows, side_width:side_width + body_width]
            cap_source = swatches
            if not bottom and profile.get("hood_on_top") and "hood" in front.pieces:
                cap_source = projected_piece(front.photo, front.pieces["hood"], scale)
            put("torso", face, clone_cap(cap_source, body_front[-1 if bottom else 0],
                                         cap_size, bottom, overhang))

        for limb in LIMBS:
            if limb not in front.pieces:
                continue
            fabric = projected_piece(front.photo, front.pieces[limb], front_limb_scale)
            reverse = (projected_piece(back.photo, back.pieces[limb], back_limb_scale)
                       if back and limb in back.pieces else None)
            width = FACES[limb, "front"][2]
            faces = limb_faces(fabric, reverse, width, limb_height)
            for name, texture in faces.items():
                put(limb, name, texture)
            put(limb, "up", clone_cap(fabric, faces["front"][0], FACES[limb, "up"][2:], bottom=False))
            if full_sleeve:
                put(limb, "down", clone_cap(fabric, faces["front"][-1], FACES[limb, "down"][2:], bottom=True))

    output = BytesIO()
    Image.fromarray(canvas).save(output, format="PNG", icc_profile=COLOR_PROFILE.tobytes())
    return output.getvalue()
