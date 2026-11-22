"""Decode, segment and classify clothing photos for Auto Bash."""

import logging
import os
from collections.abc import Callable
from functools import lru_cache
from io import BytesIO
from threading import Lock

import cv2
import numpy as np
from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

MAX_PIXELS = 20_000_000
MAX_EDGE = 1600
COLOR_PROFILE = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
logger = logging.getLogger(__name__)
model_init_lock = Lock()
Face = tuple[int, int, int, int]

# Small images are handled concurrently by the API worker pool.
cv2.setNumThreads(1)


class PhotoError(ValueError):
    """An error the user can fix by choosing a different photo."""


def decode_photo(data: bytes) -> Image.Image:
    try:
        with Image.open(BytesIO(data), formats=("JPEG", "PNG", "WEBP")) as source:
            width, height = source.size
            if min(width, height) < 64 or width * height > MAX_PIXELS:
                raise PhotoError("Choose a photo at least 64 × 64 pixels and under 20 megapixels.")
            photo = ImageOps.exif_transpose(source).convert("RGBA")
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as error:
        raise PhotoError("Use a readable JPG, PNG, or WebP photo.") from error

    alpha = photo.getchannel("A")
    if alpha.getextrema()[1] < 128:
        raise PhotoError("This photo is empty. Try a photo with the whole item in frame.")
    if profile := photo.info.get("icc_profile"):
        try:
            photo = ImageCms.profileToProfile(
                photo.convert("RGB"), BytesIO(profile), COLOR_PROFILE, outputMode="RGB"
            )
            photo.putalpha(alpha)
        except (ImageCms.PyCMSError, ValueError, OSError):
            pass
    photo.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
    return photo


@lru_cache(maxsize=1)
def rembg_masker() -> Callable[[Image.Image], list[Image.Image]] | None:
    if os.getenv("THREADPORT_REMBG") != "1":
        return None
    try:
        from rembg import new_session

        # Cloth segmentation isolates garments even in photos worn by a person.
        return new_session("u2net_cloth_seg", providers=["CPUExecutionProvider"]).predict
    except Exception:
        logger.warning("Clothing model unavailable. Using GrabCut.", exc_info=True)
        return None


def model_mask(photo: Image.Image, mode: str) -> np.ndarray | None:
    with model_init_lock:
        masker = rembg_masker()
    if masker is not None:
        try:
            upper, lower, full = map(np.asarray, masker(photo.convert("RGB")))
            if mode == "pants":
                mask = lower
            elif mode in ("shirt", "t-shirt"):
                mask = np.maximum(upper, full)
            else:
                mask = np.maximum(np.maximum(upper, lower), full)
            if np.count_nonzero(mask > 127) > mask.size * 0.015:
                return mask
        except Exception:
            logger.warning("Clothing model could not process the photo. Using GrabCut.", exc_info=True)
    return None


def work_photo(photo: Image.Image) -> np.ndarray:
    small = photo.convert("RGB")
    small.thumbnail((512, 512), Image.Resampling.LANCZOS)
    return np.asarray(small)


def find_face(rgb: np.ndarray) -> Face | None:
    # Only inspect the top area, where a wearer's face may be visible.
    gray = cv2.cvtColor(rgb[: int(len(rgb) * 0.45)], cv2.COLOR_RGB2GRAY)
    classifier = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    faces = classifier.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(24, 24))
    if len(faces):
        return tuple(int(value) for value in max(faces, key=lambda face: face[2] * face[3]))
    return None


def largest_component(mask: np.ndarray) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8))
    if count < 2:
        return mask.astype(bool)
    foreground = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    return labels == foreground


def dark_fabric(gray: np.ndarray, edge: int) -> np.ndarray | None:
    """Find a cohesive dark flat-lay against a substantially lighter border."""
    height, width = gray.shape
    border = np.concatenate((gray[:edge].ravel(), gray[-edge:].ravel(),
                             gray[:, :edge].ravel(), gray[:, -edge:].ravel()))
    backdrop = np.percentile(border, 35)
    subject = np.percentile(gray[height // 4:3 * height // 4, width // 3:2 * width // 3], 30)
    if subject > 72 or backdrop - subject < 52:
        return None
    mask = largest_component(gray < subject + (backdrop - subject) * 0.56)
    if not 0.12 < mask.mean() < 0.88 or np.mean(mask[:, (0, -1)]) > 0.12:
        return None
    # Flood from the image edge to retain light lettering enclosed by the garment.
    exterior = (~mask).astype(np.uint8)
    _, labels = cv2.connectedComponents(exterior, connectivity=4)
    outside = np.unique(np.concatenate((labels[0], labels[-1], labels[:, 0], labels[:, -1])))
    return ~np.isin(labels, outside[outside != 0])


def corner_backdrop(lab: np.ndarray, edge: int) -> np.ndarray | None:
    height, width = lab.shape[:2]
    corners = np.stack([np.median(lab[y:y + edge, x:x + edge], axis=(0, 1))
                        for x in (0, width - edge) for y in (0, height - edge)])
    agreement = np.linalg.norm(corners[:, None] - corners, axis=2) < 26
    best = agreement[agreement.sum(axis=1).argmax()]
    if best.sum() < 3:
        return None
    return np.median(corners[best], axis=0)


def grabcut_mask(rgb: np.ndarray, face: Face | None, worn: bool) -> np.ndarray:
    height, width = rgb.shape[:2]
    edge = max(2, min(height, width) // 40)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    edges = [lab[:edge], lab[-edge:], lab[:, :edge], lab[:, -edge:]]
    palettes = [np.median(side.reshape(-1, 3), axis=0) for side in edges]
    distance = np.minimum.reduce([np.linalg.norm(lab - color, axis=2) for color in palettes])
    border = np.concatenate([distance[:edge].ravel(), distance[-edge:].ravel(),
                             distance[:, :edge].ravel(), distance[:, -edge:].ravel()])
    threshold = max(13, min(30, np.percentile(border, 65) * 1.35))

    possible = distance > threshold
    dark = None
    center = np.zeros((height, width), dtype=bool)
    center[height // 6: 5 * height // 6, width // 5: 4 * width // 5] = True

    def centerpiece(values):
        return cv2.erode((values & center).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)

    core = centerpiece(possible)
    if not worn and np.count_nonzero(core) < height * width * 0.005:
        # A close product crop may put the garment on several frame edges.
        # Use agreeing corners if the dominant side colors hid the cloth.
        backdrop = corner_backdrop(lab, edge)
        if backdrop is not None:
            distance = np.linalg.norm(lab - backdrop, axis=2)
            possible = distance > threshold
            core = centerpiece(possible)
        if np.count_nonzero(core) < height * width * 0.005:
            raise PhotoError("We couldn't find the clothing. Try a clear photo against a plain background.")

    initial = np.where(possible, cv2.GC_PR_FGD, cv2.GC_PR_BGD).astype(np.uint8)
    if face is None and not worn:
        # Color-matched background connected to the edge includes the gap between spread legs.
        _, matches = cv2.connectedComponents((distance < threshold * 0.95).astype(np.uint8))
        edge_labels = np.unique(np.concatenate((matches[0], matches[-1], matches[:, 0], matches[:, -1])))
        initial[np.isin(matches, edge_labels[edge_labels != 0])] = cv2.GC_BGD
        initial[largest_component(core) & (distance > threshold * 1.2)] = cv2.GC_FGD
        dark = dark_fabric(lab[:, :, 0], edge)
        if dark is not None:
            # Teach GrabCut about the sleeves and hem outside its center seed.
            kernel = np.ones((5, 5), np.uint8)
            interior = cv2.erode(dark.astype(np.uint8), kernel).astype(bool)
            initial[interior] = cv2.GC_FGD
    elif face is not None:
        x, y, w, h = face
        # The visible face anchors the person and keeps distant scenery out of the cutout.
        left, right = max(0, x - w), min(width, x + 2 * w)
        initial[:max(0, y - h // 3)] = cv2.GC_BGD
        initial[:, :left] = cv2.GC_BGD
        initial[:, right:] = cv2.GC_BGD
        initial[y + h:min(height, y + 4 * h), x + w // 3:x + 2 * w // 3] = cv2.GC_FGD
        # The lower crop can touch the frame. Learn from dark fabric in the
        # center rather than treating a matching background color as certain.
        lower_left, lower_right = max(0, x - w // 2), min(width, x + 3 * w // 2)
        lower_region = initial[height // 2:, lower_left:lower_right]
        lower_light = lab[height // 2:, lower_left:lower_right, 0]
        if lower_light.size:
            threshold = np.percentile(lower_light, 20)
            lower_region[(lower_light < threshold) & (lower_region != cv2.GC_BGD)] = cv2.GC_FGD
    else:
        # A centered torso can match the wall color when a photo is worn.
        # Keep a strip of its pixels as clothing seeds and use the corners as background.
        initial[height // 5:4 * height // 5, 2 * width // 5:3 * width // 5] = cv2.GC_FGD
        initial[:height // 8, :width // 8] = cv2.GC_BGD
        initial[:height // 8, -width // 8:] = cv2.GC_BGD
        # A front graphic can share skin colors. Seed the outside arms and
        # the neck as background while leaving the center print to GrabCut.
        side = np.ones((height, width), dtype=bool)
        side[height // 9:, width // 4:3 * width // 4] = False
        initial[skin_mask(rgb) & side] = cv2.GC_BGD
    # The artificial border supplies background seeds without trimming clothes touching the frame.
    padded = cv2.copyMakeBorder(rgb, edge, edge, edge, edge, cv2.BORDER_CONSTANT,
                                value=tuple(float(value) for value in np.median(rgb[0], axis=0)))
    labels = np.pad(initial, edge, constant_values=cv2.GC_BGD)
    cv2.grabCut(padded, labels, None, np.zeros((1, 65)), np.zeros((1, 65)), 2, cv2.GC_INIT_WITH_MASK)
    foreground = largest_component(labels[edge:-edge, edge:-edge] % 2)
    if dark is not None:
        foreground &= cv2.dilate(dark.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    if not worn and face is None and foreground.any():
        lightness = lab[:, :, 0]
        surface = np.percentile(lightness[foreground], 90)
        if surface < 170:
            # A light object touching the photograph's border is not fabric
            # when the garment itself is much darker. Keep interior graphics.
            glints = foreground & (lightness > max(190, surface + 54))
            _, components = cv2.connectedComponents(glints.astype(np.uint8), connectivity=4)
            boundary = np.concatenate((components[:2].ravel(), components[-2:].ravel(),
                                       components[:, :2].ravel(), components[:, -2:].ravel()))
            foreground &= ~np.isin(components, np.unique(boundary[boundary != 0]))
    return foreground.astype(np.uint8) * 255


def skin_mask(rgb: np.ndarray) -> np.ndarray:
    _, cr, cb = cv2.split(cv2.cvtColor(rgb, cv2.COLOR_RGB2YCrCb))
    _, saturation, value = cv2.split(cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV))
    return (cr > 139) & (cr < 181) & (cb >= 75) & (cb < 124) & (saturation > 40) & (value > 48)


def has_wearer_neck(rgb: np.ndarray) -> bool:
    skin = skin_mask(rgb)
    height, width = skin.shape
    top = skin[:height // 4]
    shoulder = width // 4
    return bool(
        top[:, shoulder:-shoulder].mean() > 0.08
        and max(top[:, :shoulder].mean(), top[:, -shoulder:].mean()) < 0.09
        and min(skin[height // 2:, :shoulder].mean(), skin[height // 2:, -shoulder:].mean()) > 0.12
    )


def exposed_skin(rgb: np.ndarray, foreground: np.ndarray) -> tuple[np.ndarray, bool]:
    skin = skin_mask(rgb) & foreground
    middle = skin[len(skin) // 4: -len(skin) // 8]
    side = max(1, skin.shape[1] // 4)
    two_arms = min(middle[:, :side].sum(), middle[:, -side:].sum()) > skin.size * 0.012
    return skin, bool(two_arms)


def trim_skin(skin: np.ndarray, foreground: np.ndarray) -> np.ndarray:
    if skin.sum() > foreground.sum() * 0.45:
        return foreground
    rim = foreground & ~cv2.erode(foreground.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    _, labels, stats, _ = cv2.connectedComponentsWithStats(skin.astype(np.uint8))
    remove = np.unique(labels[rim & (labels > 0)])
    remove = remove[stats[remove, cv2.CC_STAT_AREA] >= max(12, skin.size * 0.001)]
    return largest_component(foreground & ~np.isin(labels, remove))


def classify(rgb: np.ndarray, foreground: np.ndarray, worn: bool) -> tuple[str, str, str]:
    y, x = np.where(foreground)
    shape = foreground[y.min():y.max() + 1, x.min():x.max() + 1]
    height, width = shape.shape
    lower = shape[height // 2:]
    left_count = lower.cumsum(axis=1)
    right_count = left_count[:, -1:] - left_count
    central = slice(2 * width // 5, max(2 * width // 5 + 1, 3 * width // 5))
    min_leg_width = max(1, width // 12)
    gaps = ~lower & (left_count >= min_leg_width) & (right_count >= min_leg_width)
    middle = slice(width * 45 // 100, max(width * 45 // 100 + 1, width * 55 // 100))
    # A long jacket can have two sleeve gaps, but its lower center is the
    # jacket body. Pants separate through the middle of the lower silhouette.
    center_coverage = shape[height * 3 // 4:, middle].mean()
    has_legs = bool(gaps[:, central].mean(axis=0).max() > 0.38 and center_coverage < 0.48)
    if worn:
        photo_type = "worn"
    else:
        matte = rgb[~foreground]
        light_studio = len(matte) > 0 and np.median(matte) > 226
        upper_rows = shape[:max(1, height // 10)]
        neck = upper_rows[:, width * 2 // 5: max(width * 2 // 5 + 1, width * 3 // 5)]
        shoulders = upper_rows[:, width // 5: max(width // 5 + 1, width * 2 // 5)]
        if shape.mean() > 0.84 and not has_legs:
            photo_type = "folded"
        elif light_studio and shoulders.mean() > 0.45 and neck.mean() < 0.22:
            photo_type = "ghost_mannequin"
        elif light_studio or upper_rows.mean() < 0.14:
            photo_type = "hanger_product"
        else:
            photo_type = "flat_lay"

    if has_legs:
        return ("shorts" if height / width < 1.15 else "pants"), photo_type, "pants"

    widths = shape.sum(axis=1)
    shoulders = widths[height // 8: max(height // 8 + 1, height // 2)].max()
    waist = np.median(widths[height // 2: max(height // 2 + 1, 4 * height // 5)])
    if shoulders > waist * 1.22:
        hem = widths[3 * height // 5: max(3 * height // 5 + 1, 4 * height // 5)]
        garment = "long_sleeve" if np.median(hem) > width * 0.79 else "t_shirt"
    else:
        garment = "top"
    return garment, photo_type, "shirt"


def retain_interior_print(mask: np.ndarray) -> np.ndarray:
    """Keep letter and graphic pixels enclosed by fabric, away from the neck."""
    foreground = mask > 127
    ys, xs = np.nonzero(foreground)
    if not len(ys):
        return mask
    left, right = xs.min(), xs.max()
    top, bottom = ys.min(), ys.max()
    height, width = bottom - top + 1, right - left + 1
    max_area = len(xs) * 0.16
    count, labels, stats, _ = cv2.connectedComponentsWithStats((~foreground).astype(np.uint8), connectivity=4)
    filled = mask.copy()
    for label in range(1, count):
        x, y, w, h, area = stats[label]
        if (x > left + width * 0.06 and x + w < right - width * 0.06
                and y > top + height * 0.14 and y + h < bottom - height * 0.08 and area < max_area):
            filled[labels == label] = 255
    return filled


def prepare_cutout(
    photo: Image.Image, rgb: np.ndarray, face: Face | None, mode: str,
    *, isnet_mask: np.ndarray | None = None,
) -> tuple[bytes, dict[str, str]]:
    worn = face is not None or has_wearer_neck(rgb)
    alpha = np.asarray(photo.getchannel("A"))
    if np.count_nonzero(alpha < 128) > alpha.size * 0.015:
        method = "existing_alpha"
        mask = alpha
    elif isnet_mask is not None:
        method = "isnet"
        mask = isnet_mask
    elif (model := model_mask(photo, mode)) is not None:
        method = "rembg"
        mask = model
    else:
        method = "grabcut"
        mask = grabcut_mask(rgb, face, worn)

    height, width = rgb.shape[:2]
    small = cv2.resize(mask, (width, height), interpolation=cv2.INTER_AREA)
    foreground = small > 127
    skin, two_arms = exposed_skin(rgb, foreground)
    worn = worn or two_arms
    if worn and method != "existing_alpha":
        if face is not None and method == "grabcut":
            x, y, w, h = face
            skin[:min(height, y + h), max(0, x - w // 4):min(width, x + 5 * w // 4)] = True
            if mode == "pants" or (mode == "auto" and height > 1.15 * width):
                # Lit hands on the edge of a full-body photo can have pink
                # chroma outside the initial skin range.
                _, red, blue = cv2.split(cv2.cvtColor(rgb, cv2.COLOR_RGB2YCrCb))
                skin |= foreground & (red > 144) & (blue <= 135)
        foreground = trim_skin(skin, foreground)
        small = np.where(foreground, small, 0).astype(np.uint8)
        mask = small

    if foreground.mean() < 0.015:
        raise PhotoError("We couldn't find the clothing. Try a clear photo against a plain background.")
    garment, photo_type, suggested_mode = classify(rgb, foreground, worn)
    if method == "rembg" and not worn and mode in ("auto", "pants") and suggested_mode != "pants":
        # The model can label the background between flat-laid legs as fabric.
        # Prefer the color-based cutout when it clearly retains the two legs.
        try:
            alternative = grabcut_mask(rgb, face, worn)
        except PhotoError:
            pass
        else:
            candidate = alternative > 127
            if candidate.mean() >= 0.015:
                alt_garment, alt_photo, alt_mode = classify(rgb, candidate, worn)
                if alt_mode == "pants":
                    mask, method = alternative, "grabcut"
                    garment, photo_type, suggested_mode = alt_garment, alt_photo, alt_mode
    if method == "rembg" and mode == "pants" and suggested_mode != "pants":
        garment = "pants"  # The model's lower-clothing class supplied the mask.
    selected = suggested_mode if mode == "auto" else mode
    if method == "grabcut" and not worn and selected in ("shirt", "t-shirt"):
        mask = retain_interior_print(mask)

    if mask.shape != alpha.shape:
        mask = cv2.resize(mask, photo.size, interpolation=cv2.INTER_LINEAR)
    foreground_alpha = np.minimum(mask, alpha)
    cutout = Image.new("RGBA", photo.size)
    cutout.paste(photo, mask=Image.fromarray((foreground_alpha > 0).astype(np.uint8) * 255))
    cutout.putalpha(Image.fromarray(foreground_alpha))
    png = BytesIO()
    cutout.save(png, format="PNG", icc_profile=COLOR_PROFILE.tobytes())
    return png.getvalue(), {
        "garment_type": garment,
        "photo_type": photo_type,
        "mode": selected,
        "method": method,
    }
