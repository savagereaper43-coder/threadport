"""Continue observed shirt fabric around inferred torso faces."""

import cv2
import numpy as np

from autobash_core.autobash import apply_shading

from .fabric_pattern import reflected_indices
from .garment_parts import crop_silhouette, top_parts
from .photos import PhotoError
from .placement import FACES, LIMBS, FabricPatches, clone_cap, limb_faces, photograph, projected_piece
from .quality import face_view

DETAIL_ROWS = slice(24, 110)
INFERRED_TORSO = ("left", "back", "right")


def horizontal_detail(face: np.ndarray) -> np.ndarray:
    return np.abs(np.diff(face[..., :3].astype(np.float32), axis=1)).mean(axis=(1, 2))


def choose_swatch(front: np.ndarray) -> tuple[np.ndarray, int] | None:
    """Find a sustained textured strip clear of the collar and placket."""
    width = front.shape[1]
    strips = (front[:, width // 9:width * 7 // 16], front[:, width * 9 // 16:width * 8 // 9])
    candidates = []
    for strip in strips:
        opaque = (strip[..., 3] == 255)
        supported = (opaque.mean(axis=1) >= 0.94)
        visible = supported[DETAIL_ROWS]
        if visible.mean() < 0.87:
            continue
        detail = horizontal_detail(strip[DETAIL_ROWS][visible])
        if np.median(detail) >= 8 and (detail >= 6).mean() >= 0.72:
            candidates.append((float(np.median(detail)), strip, supported))
    if len(candidates) != len(strips):
        return None
    # Both sides show texture, so a solitary chest graphic cannot qualify as
    # a print throughout the cloth. Keep the richer observed strip as donor.
    _, strip, valid = max(candidates, key=lambda item: item[0])
    top, bottom = np.flatnonzero(valid)[[0, -1]]
    top = max(top, 28)  # Keep the photographed collar on its front face.
    strip = strip[top:bottom + 1]
    try:
        if not (strip[..., 3] == 255).all():
            strip = FabricPatches(strip).fill(strip)
    except PhotoError:
        return None
    return strip, int(top)


def replace_collapsed_sleeves(replacement: np.ndarray, template: np.ndarray,
                             photo: np.ndarray, mask: np.ndarray, scale: float) -> set[tuple[str, str]]:
    sizes = {limb: int(np.count_nonzero(face_view(template, limb, "front")[..., 3].any(axis=1)))
             for limb in LIMBS}
    # Full-length arms already have an independent cuff-fitting pass.
    if not all(32 <= height <= 64 for height in sizes.values()):
        return set()
    try:
        pixels, silhouette = crop_silhouette(photo.copy(), mask)
        parts = top_parts(pixels, silhouette, "t_shirt", back=False, flat_tshirt=False)
    except PhotoError:
        return set()
    repaired = set()
    for limb, height in sizes.items():
        front = face_view(template, limb, "front")[:height]
        if limb not in parts.pieces or (horizontal_detail(front) < 8).mean() < 0.24:
            continue
        fabric = projected_piece(parts.photo, parts.pieces[limb], scale)
        if (fabric[..., 3] == 255).sum() < 280:
            continue
        try:
            faces = limb_faces(fabric, None, front.shape[1], height)
            faces["up"] = clone_cap(fabric, faces["front"][0], FACES[limb, "up"][2:], bottom=False)
        except PhotoError:
            continue
        for face, texture in faces.items():
            target = face_view(replacement, limb, face)
            target[:len(texture)] = texture
            repaired.add((limb, face))
    return repaired


def continue_fabric(template: np.ndarray, photo: np.ndarray, mask: np.ndarray,
                    *, left: int, top: int, scale: float, shading: float) -> None:
    """Replace collapsed texture on an inferred wrap with same-scale pixel copies."""
    front = face_view(template, "torso", "front")
    height, width = front.shape[:2]
    detail = horizontal_detail(front)[DETAIL_ROWS]
    if not any(((detail >= 11)
                & (horizontal_detail(face_view(template, "torso", side))[DETAIL_ROWS]
                   < np.maximum(2.5, detail * 0.20))).mean() >= 0.28 for side in INFERRED_TORSO):
        return

    side_width = FACES["torso", "left"][2]
    inside = cv2.erode(mask.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    photo = photo.copy()
    photo[..., 3] = inside.astype(np.uint8) * 255
    projected = photograph(photo, np.eye(2), scale, (side_width - left * scale, -top * scale),
                            (width + 2 * side_width, height))
    source = choose_swatch(projected[:, side_width:side_width + width])
    if source is None:
        return
    swatch, first_row = source
    rows = reflected_indices(np.arange(height) - first_row, len(swatch))
    reflected = swatch[rows[:, None], reflected_indices(np.arange(2 * swatch.shape[1]), swatch.shape[1])]
    ring_width = width + 2 * side_width
    columns = np.arange(ring_width)[None, :] + np.arange(reflected.shape[1])[:, None]
    columns %= reflected.shape[1]
    # Fit one continuous texture around the entire inferred band. Using one
    # column offset keeps the weave constant from shoulder to hem.
    first, last = front[DETAIL_ROWS, -1, :3], front[DETAIL_ROWS, 0, :3]
    cost = np.abs(reflected[DETAIL_ROWS, columns[:, 0], :3].astype(float) - first[:, None]).mean(axis=(0, 2))
    cost += np.abs(reflected[DETAIL_ROWS, columns[:, -1], :3].astype(float) - last[:, None]).mean(axis=(0, 2))
    band = reflected[:, columns[cost.argmin()]].copy()

    # Keep contiguous visible fabric immediately past the front boundaries.
    right = projected[:, :side_width]
    left = projected[:, side_width + width:]
    for observed, inferred, direction in ((left, band[:, :side_width], 1),
                                         (right, band[:, -side_width:], -1)):
        count = 12
        observed = observed[:, ::direction][:, :count]
        inferred = inferred[:, ::direction][:, :count]
        valid = np.logical_and.accumulate(observed[..., 3] == 255, axis=1)
        inferred[valid] = observed[valid]

    replacement = np.zeros_like(template)
    offset = 0
    for side in INFERRED_TORSO:
        face = face_view(replacement, "torso", side)
        face[:] = band[:, offset:offset + face.shape[1]]
        offset += face.shape[1]
    for face_name, row_start in (("up", 0), ("down", height - FACES["torso", "down"][3])):
        cap = face_view(replacement, "torso", face_name)
        cap[:] = band[row_start:row_start + cap.shape[0], side_width:side_width + width]
        cap[..., 3] = face_view(template, "torso", face_name)[..., 3]
    repaired = replace_collapsed_sleeves(replacement, template, photo, mask, scale)
    repaired.update(("torso", side) for side in (*INFERRED_TORSO, "up", "down"))
    replacement = apply_shading(replacement, shading)
    for part, face in repaired:
        face_view(template, part, face)[:] = face_view(replacement, part, face)
