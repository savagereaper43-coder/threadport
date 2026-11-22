"""Recover observable details when the shirt core falls back to torso cloth."""

from dataclasses import replace

import cv2
import numpy as np

from .garment_parts import GarmentParts, Piece, profile_rows, segment_parts
from .photos import PhotoError, largest_component
from .placement import FACES, LIMBS, FabricPatches, body_layer, body_material, body_scale, place_template
from .quality import face_view, rgba


def contrasting_sleeves(parts: GarmentParts) -> dict[str, Piece]:
    photo = parts.photo
    height, width = photo.shape[:2]
    foreground = photo[..., 3] == 255
    hue, saturation, value = cv2.split(cv2.cvtColor(photo[..., :3], cv2.COLOR_RGB2HSV))
    colorful = foreground & (saturation >= 84) & (value >= 65)
    rows, columns = np.ogrid[:height, :width]
    edges = (columns < width * 0.31, columns > width * 0.69)
    keys = []
    for edge in edges:
        area = foreground & edge & (rows < height * 0.52)
        colors = hue[colorful & area]
        if len(colors) < max(75, area.sum() * 0.21):
            return {}
        keys.append(int(np.bincount(colors, minlength=180).argmax()))
    if min(abs(keys[0] - keys[1]), 180 - abs(keys[0] - keys[1])) > 11:
        return {}
    center = foreground & (columns >= width * 0.37) & (columns <= width * 0.63) & (rows < height * 0.44)
    hue_gap = np.abs(hue.astype(int) - keys[0])
    similar = colorful & (np.minimum(hue_gap, 180 - hue_gap) <= 13)
    if (similar & center).sum() > center.sum() * 0.18:
        return {}
    result = {}
    for index, (limb, color) in enumerate(zip(LIMBS, keys)):
        outer_band = columns < width * 0.43 if index == 0 else columns > width * 0.57
        delta = np.abs(hue.astype(int) - color)
        seed = colorful & (np.minimum(delta, 180 - delta) <= 13) & outer_band & (rows < height * 0.59)
        joined = cv2.morphologyEx(seed.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
        ys, xs = np.nonzero(largest_component(joined) & foreground)
        if len(ys) < max(140, foreground.sum() * 0.022):
            return {}
        points = np.column_stack((xs, ys)).astype(np.int32)
        mask = np.zeros((height, width), np.uint8)
        cv2.fillConvexPoly(mask, cv2.convexHull(points), 1)
        mask = (mask > 0) & foreground
        top, bottom = np.percentile(ys, (25, 75))
        direction = (float(np.median(xs[ys >= bottom]) - np.median(xs[ys <= top])), max(1., bottom - top))
        result[limb] = Piece(mask, direction)
    return result


def recover_worn_template(cutout: bytes, shading: float, template: np.ndarray) -> bool:
    """Use photographed short sleeves and the wider upper torso of a worn top."""
    try:
        parts = segment_parts(cutout, "shirt", "t_shirt", profile="t_shirt", photo_type="worn")
        sleeves = contrasting_sleeves(parts)
        if not sleeves:
            return False
        height = parts.photo.shape[0]
        torso = parts.photo[..., 3] == 255
        for piece in sleeves.values():
            torso &= ~piece.mask
        lefts, rights = profile_rows(torso)
        band = slice(height * 11 // 100, height * 32 // 100)
        left, right = np.nanmedian(lefts[band]), np.nanmedian(rights[band])
        if not np.isfinite([left, right]).all() or right - left < parts.body[2] - parts.body[0]:
            return False
        top = int(parts.body[1])
        bottom = min(height - 1, top + round(right - left))
        # Keep the print near its original position and at one uniform scale.
        # The rest of the garment remains the core's output.
        recovered = replace(parts, body=(float(left), top, float(right), bottom), pieces=sleeves)
        artwork = rgba(place_template("shirt", recovered))
        torso_photo = parts.photo.copy()
        torso_photo[~torso] = 0
        torso_parts = replace(recovered, photo=torso_photo)
        body_w, body_h = FACES["torso", "front"][2:]
        side_w = FACES["torso", "right"][2]
        scale = body_scale(torso_parts, body_w, body_h)
        material = body_material(replace(parts, photo=torso_photo), scale, (body_w, body_h))
        quiet = material[material.shape[0] // 2:]
        donor = quiet if quiet[..., 3].any() else material
        band = FabricPatches(donor).fill(body_layer(torso_parts, scale, body_w + 2 * side_w, body_h, 0, body_h))
        for face, columns in zip(("right", "front", "left"),
                                 (slice(0, side_w), slice(side_w, side_w + body_w), slice(side_w + body_w, None))):
            face_view(artwork, "torso", face)[:] = band[:, columns]
    except PhotoError:
        return False

    from autobash_core.autobash import apply_shading

    artwork = apply_shading(artwork, shading)
    for part, face in FACES:
        if part in LIMBS or (part == "torso" and face in ("front", "left", "right")):
            face_view(template, part, face)[:] = face_view(artwork, part, face)
    return True
