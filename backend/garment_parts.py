"""Measure clothing silhouettes and unwrap the observed panels into straight textures."""

from dataclasses import dataclass
from io import BytesIO

import cv2
import numpy as np
from PIL import Image

from .photos import PhotoError, largest_component

MIN_PANEL_PIXELS = 10


@dataclass(frozen=True)
class Piece:
    mask: np.ndarray
    axis: tuple[float, float] = (0, 1)

    def axes(self) -> np.ndarray:
        axis = np.asarray(self.axis, dtype=np.float64)
        axis /= np.linalg.norm(axis)
        return np.array([[axis[1], -axis[0]], axis])

    def bounds(self) -> tuple[np.ndarray, np.ndarray]:
        ys, xs = np.nonzero(self.mask)
        center = self.axes() @ np.stack((xs, ys))
        return center.min(axis=1), center.max(axis=1)


@dataclass
class GarmentParts:
    profile: str
    photo: np.ndarray
    body: tuple[float, int, float, int]
    pieces: dict[str, Piece]


def silhouette(png: bytes) -> tuple[np.ndarray, np.ndarray]:
    with Image.open(BytesIO(png)) as photo:
        rgba = np.array(photo.convert("RGBA"))
    mask = largest_component(rgba[:, :, 3] >= 192)
    mask = cv2.erode(mask.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    rgba[~mask] = 0
    rgba[:, :, 3][mask] = 255
    ys, xs = np.nonzero(mask)
    if len(ys) == 0 or min(np.ptp(ys), np.ptp(xs)) < MIN_PANEL_PIXELS * 2:
        raise PhotoError("Use a photo with the whole garment in frame so we can find its parts.")
    crop = np.s_[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return rgba[crop], mask[crop]


def profile_rows(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    left = mask.argmax(axis=1)
    right = mask.shape[1] - 1 - mask[:, ::-1].argmax(axis=1)
    valid = mask.any(axis=1)
    return np.where(valid, left, np.nan), np.where(valid, right, np.nan)


def body_rows(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Follow the center-connected torso run when sleeves hang alongside it."""
    width = mask.shape[1]
    center = width // 2
    smoothed = cv2.morphologyEx(
        mask.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((1, max(3, width // 40)), np.uint8)
    ).astype(bool)
    before = np.where(~smoothed[:, :center], np.arange(center), -1).max(axis=1)
    after = np.where(~smoothed[:, center:], np.arange(center, width), width).min(axis=1)
    return np.where(smoothed[:, center], before + 1, np.nan), np.where(smoothed[:, center], after - 1, np.nan)


def span(left: np.ndarray, right: np.ndarray, start: int, end: int) -> tuple[float, float]:
    return float(np.nanmedian(left[start:end])), float(np.nanmedian(right[start:end]))


def leg_piece(mask: np.ndarray) -> Piece:
    ys, xs = np.nonzero(mask)
    if len(ys) < MIN_PANEL_PIXELS ** 2:
        raise PhotoError("Spread the pants flat so both legs are visible.")
    start, end = np.percentile(ys, (10, 90))
    top = xs[ys <= start]
    cuff = xs[ys >= end]
    axis = float(np.median(cuff) - np.median(top)), max(1., float(end - start))
    return Piece(mask, axis)


def paired_legs(mask: np.ndarray) -> tuple[int, int]:
    """Find the uppermost sustained opening between the two legs."""
    height, width = mask.shape
    left_count = mask.cumsum(axis=1)
    right_count = left_count[:, -1:] - left_count
    between = ~mask & (left_count >= width * 0.10) & (right_count >= width * 0.10)
    # Ignore holes and single-pixel JPEG artifacts when locating the crotch.
    between = cv2.erode(between.astype(np.uint8), np.ones((1, max(3, width // 85)), np.uint8)).astype(bool)
    central = slice(width * 3 // 10, width * 7 // 10)
    lower_rows = between[height // 2:, central]
    separation = lower_rows.mean(axis=0)
    peaks = np.flatnonzero(separation >= max(0.25, separation.max() * 0.88))
    if not len(peaks):
        raise PhotoError("Lay the pants flat with space between the legs, then try again.")
    split = int(np.median(peaks)) + central.start
    tolerance = max(2, width * 8 // 100)
    gap = between[:, max(0, split - tolerance):split + tolerance + 1].any(axis=1)
    window = max(5, height // 25)
    starts = np.flatnonzero(np.convolve(gap, np.ones(window), "valid") >= window * 0.85)
    starts = starts[(starts > height * 0.10) & (starts < height * 0.72)]
    if not len(starts):
        raise PhotoError("Lay the pants flat with the waistband and both cuffs in frame.")
    return int(starts[0]), split


def bottom_parts(rgba: np.ndarray, mask: np.ndarray, profile: str, back: bool, worn: bool) -> GarmentParts:
    height, width = mask.shape
    crotch, split = paired_legs(mask)
    left, right = profile_rows(mask)
    waist = np.flatnonzero(mask[:crotch].sum(axis=1) >= width * 0.32)
    if len(waist) == 0:
        raise PhotoError("Keep the waistband and both legs in frame.")
    top = int(waist[0]) + 1
    if worn:
        # A whole-body photo can start at the shoulders. Use the crotch and
        # leg length to isolate the approximate waist above them.
        top = max(top, crotch - round((height - crotch) * 0.22))
    hem = crotch - max(2, height // 85)
    top_edges = span(left, right, top, min(hem, top + 5))
    hem_edges = span(left, right, max(top, hem - 4), hem + 1)
    body = (min(top_edges[0], hem_edges[0]), top, max(top_edges[1], hem_edges[1]), hem)
    limbs = []
    for side in (slice(None, split), slice(split, None)):
        piece = np.zeros_like(mask)
        piece[hem:, side] = mask[hem:, side]
        limbs.append(leg_piece(largest_component(piece)))
    if back:
        limbs.reverse()
    return GarmentParts(profile, rgba, body, dict(zip(("rightLimb", "leftLimb"), limbs)))


def distinguish_sleeve(rgba: np.ndarray, sleeve: np.ndarray, screen_left: bool) -> np.ndarray:
    """Use a distinct sleeve color to exclude visible chest fabric."""
    ys, xs = np.nonzero(sleeve)
    lo, hi = np.percentile(xs, (25, 75))
    outside = xs <= lo if screen_left else xs >= hi
    hsv = cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2HSV)
    hue, saturation, light = cv2.split(hsv)
    vivid = (saturation >= 90) & (light >= 60)
    swatch = hue[ys, xs][outside & vivid[ys, xs]]
    if len(swatch) < outside.sum() * 0.29:
        return sleeve
    key = int(np.bincount(swatch, minlength=180).argmax())
    difference = np.abs(hue.astype(int) - key)
    nearby = (np.minimum(difference, 180 - difference) <= 12) & vivid
    if nearby[ys, xs][outside].mean() < 0.29:
        return sleeve
    height, width = sleeve.shape
    if nearby[:height // 2, width * 2 // 5:width * 3 // 5].mean() > 0.18:
        return sleeve
    connected = cv2.morphologyEx((sleeve & nearby).astype(np.uint8), cv2.MORPH_CLOSE,
                                np.ones((7, 7), np.uint8)).astype(bool)
    trimmed = largest_component(connected & sleeve)
    return trimmed if trimmed.sum() >= max(100, sleeve.sum() * 0.18) else sleeve


def top_parts(rgba: np.ndarray, mask: np.ndarray, profile: str | None, back: bool,
              flat_tshirt: bool) -> GarmentParts:
    height, width = mask.shape
    body_left, body_right = body_rows(mask)
    waist_l, waist_r = span(body_left, body_right, height * 53 // 100, height * 76 // 100)
    hem_l, hem_r = span(body_left, body_right, height * 87 // 100, height * 96 // 100)
    if not np.isfinite([waist_l, waist_r, hem_l, hem_r]).all():
        raise PhotoError("Lay the top flat so we can see its middle and hem.")
    torso_width = waist_r - waist_l
    torso_rows = mask[:, int(waist_l):int(waist_r) + 1].sum(axis=1)
    shoulders = np.flatnonzero(torso_rows >= torso_width * 0.83)
    early = shoulders[shoulders < height // 2]
    low = shoulders[shoulders > height // 2]
    if not len(early) or not len(low):
        raise PhotoError("Lay the top flat so we can see the shoulders and hem.")
    shoulder = int(early[0])
    hem = int(low[-1]) - 1
    hooded = shoulder > height * 0.14 and mask[:shoulder // 2].mean() < 0.35

    grid_y, grid_x = np.ogrid[:height, :width]
    y_fraction = np.clip((grid_y - shoulder) / max(1, hem - shoulder), 0, 1)
    side_l = waist_l + (hem_l - waist_l) * y_fraction
    side_r = waist_r + (hem_r - waist_r) * y_fraction
    sleeve_masks = [mask & (grid_x < side_l + torso_width * 0.05),
                    mask & (grid_x > side_r - torso_width * 0.05)]
    long = all(piece[height * 60 // 100:height * 82 // 100].sum() > torso_width * height * 0.022
               for piece in sleeve_masks)
    profile = profile or ("hoodie" if hooded else "long_sleeve" if long else "t_shirt")
    body = (min(waist_l, hem_l), shoulder, max(waist_r, hem_r), hem)
    pieces: dict[str, Piece] = {}
    if flat_tshirt:
        return GarmentParts(profile, rgba, body, pieces)

    for index, piece in enumerate(sleeve_masks):
        outer_edge = side_l - torso_width * 0.045 if index == 0 else side_r + torso_width * 0.045
        outside = (grid_x < outer_edge) if index == 0 else (grid_x > outer_edge)
        limit = height if profile in ("long_sleeve", "hoodie") and long else height * 56 // 100
        cuff_y, cuff_x = np.nonzero(piece[:limit] & outside[:limit])
        if len(cuff_x) < MIN_PANEL_PIXELS ** 2:
            continue  # Sleeveless tops have no photographed arm material.
        direction_x = -1 if index == 0 else 1
        distal = direction_x * cuff_x >= np.percentile(direction_x * cuff_x, 78)
        inner_x = waist_l if index == 0 else waist_r
        axis = (float(np.median(cuff_x[distal])) - inner_x,
                max(height * 0.10, float(np.median(cuff_y[distal])) - shoulder))
        sleeve = largest_component(piece & (grid_y < limit))
        if sleeve.sum() >= MIN_PANEL_PIXELS ** 2:
            part = "rightLimb" if (index == 0) != back else "leftLimb"
            pieces[part] = Piece(distinguish_sleeve(rgba, sleeve, index == 0), axis)

    if profile == "hoodie" and hooded:
        pieces["hood"] = Piece(mask & (grid_y < shoulder))
    return GarmentParts(profile, rgba, body, pieces)


def segment_parts(png: bytes, mode: str, garment_type: str, *, back: bool = False,
                  profile: str | None = None, photo_type: str | None = None) -> GarmentParts:
    rgba, mask = silhouette(png)
    if mode == "pants":
        return bottom_parts(rgba, mask, profile or ("shorts" if garment_type == "shorts" else "pants"),
                            back, worn=photo_type == "worn")
    return top_parts(rgba, mask, profile, back, flat_tshirt=mode == "t-shirt")
