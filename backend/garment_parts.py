"""Measure clothing silhouettes and unwrap the observed panels into straight textures."""

from dataclasses import dataclass
from io import BytesIO

import cv2
import numpy as np
from PIL import Image

from .photos import PhotoError, largest_component

TEXTURE_SIZE = 512
MIN_PANEL_PIXELS = 10


@dataclass
class GarmentParts:
    profile: str
    textures: dict[str, Image.Image]


def silhouette(png: bytes) -> tuple[np.ndarray, np.ndarray]:
    with Image.open(BytesIO(png)) as photo:
        rgba = np.array(photo.convert("RGBA"), dtype=np.float32)
    mask = largest_component(rgba[:, :, 3] >= 192)
    # Remove thin background fringes without throwing away the garment outline.
    mask = cv2.erode(mask.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    rgba[:, :, 3] *= mask
    rgba[:, :, :3] *= rgba[:, :, 3:4] / 255
    ys, xs = np.nonzero(mask)
    if len(ys) == 0 or min(np.ptp(ys), np.ptp(xs)) < MIN_PANEL_PIXELS * 2:
        raise PhotoError("Use a photo with the whole garment in frame so we can find its parts.")
    crop = np.s_[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return rgba[crop], mask[crop]


def straight_alpha(warped: np.ndarray) -> Image.Image:
    alpha = warped[:, :, 3:4]
    np.divide(warped[:, :, :3] * 255, alpha, out=warped[:, :, :3], where=alpha > 0)
    return Image.fromarray(np.clip(warped.round(), 0, 255).astype(np.uint8))


def flat_panel(rgba: np.ndarray, top: int, bottom: int, upper: tuple[float, float],
               lower: tuple[float, float]) -> Image.Image:
    """Use the shoulder/waist and hem corners to undo the panel's perspective."""
    if bottom - top < MIN_PANEL_PIXELS or min(upper[1] - upper[0], lower[1] - lower[0]) < MIN_PANEL_PIXELS:
        raise PhotoError("Lay the garment flat and keep the whole item in frame.")
    source = np.float32([[upper[0], top], [upper[1], top], [lower[1], bottom], [lower[0], bottom]])
    end = TEXTURE_SIZE - 1
    target = np.float32([[0, 0], [end, 0], [end, end], [0, end]])
    transform = cv2.getPerspectiveTransform(source, target)
    return straight_alpha(cv2.warpPerspective(rgba, transform, (TEXTURE_SIZE, TEXTURE_SIZE)))


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


def panel_limits(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Find the edges of each mesh row perpendicular to the limb centerline."""
    bins = np.rint(y - y.min()).astype(np.int32)
    rows = np.arange(bins.max() + 1)
    low = np.full(len(rows), np.inf)
    high = np.full(len(rows), -np.inf)
    np.minimum.at(low, bins, x)
    np.maximum.at(high, bins, x)
    width = high - low
    valid = width >= max(3, np.percentile(width[np.isfinite(width)], 75) * 0.42)
    if valid.sum() < MIN_PANEL_PIXELS:
        raise PhotoError("Spread the sleeves or legs out so we can see both edges.")
    rows = rows[valid]
    bounds = np.stack((low[valid], high[valid])).astype(np.float32)
    # Subpixel smoothing removes staircase jumps between neighboring silhouette rows.
    bounds = cv2.GaussianBlur(bounds, (7, 1), 1.5)
    return rows + y.min(), bounds[0], bounds[1]


def ribbon(rgba: np.ndarray, mask: np.ndarray, direction: tuple[float, float] = (0, 1),
           *, cuff_inset: float = 0) -> Image.Image:
    """Straighten an angled or curved sleeve/leg with a silhouette-fitted strip mesh."""
    ys, xs = np.nonzero(mask)
    if len(xs) < MIN_PANEL_PIXELS ** 2:
        raise PhotoError("We couldn't see a complete sleeve or leg. Lay it flat and try again.")
    axis = np.array(direction, dtype=np.float32)
    axis /= np.linalg.norm(axis)
    across = np.array([axis[1], -axis[0]], dtype=np.float32)
    longitudinal = xs * axis[0] + ys * axis[1]
    transverse = xs * across[0] + ys * across[1]
    rows, left, right = panel_limits(transverse, longitudinal)
    along = np.linspace(rows[0] + 1, rows[-1] - max(1, (rows[-1] - rows[0]) * cuff_inset), TEXTURE_SIZE)
    # Keep samples just inside the visible fabric, especially on angled edges.
    inset = np.minimum(2.5, (right - left) * 0.09)
    lo = np.interp(along, rows, left + inset)
    hi = np.interp(along, rows, right - inset)
    mesh_x = lo[:, None] + (hi - lo)[:, None] * np.linspace(0, 1, TEXTURE_SIZE)
    mesh_y = along[:, None]
    map_x = np.float32(mesh_x * across[0] + mesh_y * axis[0])
    map_y = np.float32(mesh_x * across[1] + mesh_y * axis[1])
    return straight_alpha(cv2.remap(rgba, map_x, map_y, cv2.INTER_LINEAR))


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


def bottom_parts(rgba: np.ndarray, mask: np.ndarray, profile: str, back: bool) -> GarmentParts:
    height, width = mask.shape
    crotch, split = paired_legs(mask)
    left, right = profile_rows(mask)
    waist = np.flatnonzero(mask[:crotch].sum(axis=1) >= width * 0.32)
    if len(waist) == 0:
        raise PhotoError("Keep the waistband and both legs in frame.")
    top = int(waist[0]) + 1
    hem = crotch - max(2, height // 85)
    top_edges = span(left, right, top, min(hem, top + 5))
    hem_edges = span(left, right, max(top, hem - 4), hem + 1)
    torso = flat_panel(rgba, top, hem, (top_edges[0] + 2, top_edges[1] - 2),
                       (hem_edges[0] + 2, hem_edges[1] - 2))
    limbs = []
    for side in (slice(None, split), slice(split, None)):
        piece = np.zeros_like(mask)
        piece[hem:, side] = mask[hem:, side]
        limbs.append(ribbon(rgba, piece))
    if back:
        limbs.reverse()
    return GarmentParts(profile, dict(zip(("torso", "rightLimb", "leftLimb"), [torso, *limbs])))


def top_parts(rgba: np.ndarray, mask: np.ndarray, profile: str | None, back: bool,
              flat_tshirt: bool) -> GarmentParts:
    height, width = mask.shape
    left, right = profile_rows(mask)
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
    top_l, top_r = span(left, right, shoulder, min(shoulder + 5, hem))
    # The upper corners follow the shoulder line. The hem stays level in the texture.
    upper = (max(waist_l, top_l) + 2, min(waist_r, top_r) - 2)
    lower = (hem_l + 3, hem_r - 3)
    torso = flat_panel(rgba, shoulder + max(2, height // 48), hem, upper, lower)
    textures = {"torso": torso}
    if flat_tshirt:
        return GarmentParts(profile, textures)

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
            cuff_inset = 0.045 if long else 0.12
            textures[part] = ribbon(rgba, sleeve, axis, cuff_inset=cuff_inset)

    if profile == "hoodie" and hooded:
        hood = mask & (grid_y < shoulder)
        try:
            textures["hood"] = ribbon(rgba, hood)
        except PhotoError:
            pass
    return GarmentParts(profile, textures)


def segment_parts(png: bytes, mode: str, garment_type: str, *, back: bool = False,
                  profile: str | None = None) -> GarmentParts:
    rgba, mask = silhouette(png)
    if mode == "pants":
        return bottom_parts(rgba, mask, profile or ("shorts" if garment_type == "shorts" else "pants"), back)
    return top_parts(rgba, mask, profile, back, flat_tshirt=mode == "t-shirt")
