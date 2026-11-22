"""Adapt validated uploads and the Classic Shirt engine's array output."""

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock

import numpy as np
from PIL import Image

from autobash_core import autobash

from .garment_parts import crop_silhouette, fitted_top
from .placement import FACES, LIMBS, limb_textures, place_template
from .photos import COLOR_PROFILE, PhotoError
from .quality import face_view, rgba
from .shirt_wrap import continue_fabric
from .worn_shirts import recover_worn_template

# The engine loads a shared rembg session lazily. Serialize shirt renders
# so concurrent requests cannot initialize it twice or compete for CPU memory.
_render_lock = Lock()


def isnet_cutout(rgb: np.ndarray) -> np.ndarray:
    """Use the same locked model as the supplied shirt renderer."""
    with _render_lock:
        return autobash.get_mask(rgb).astype(np.uint8) * 255


@dataclass(frozen=True)
class ShirtPhoto:
    image: Image.Image
    expected: Image.Image | None


def shirt_photo(original: Image.Image, cutout_png: bytes, photo_type: str) -> ShirtPhoto:
    # Give tight product crops and worn cutouts a matte around the garment.
    # Ordinary product photos enter the supplied engine untouched.
    with Image.open(BytesIO(cutout_png)) as source:
        alpha = source.getchannel("A")
        foreground = np.asarray(alpha) > 200
        reliable = photo_type != "worn" and foreground.mean() >= 0.45
        if photo_type != "worn":
            border = max(foreground[0].mean(), foreground[-1].mean(),
                         foreground[:, 0].mean(), foreground[:, -1].mean())
            if not reliable or foreground.mean() < 0.65 or border < 0.33:
                return ShirtPhoto(original, alpha if reliable else None)
        box = alpha.getbbox()
        cutout = source.crop(box).convert("RGBA") if box else source.convert("RGBA")
    pixels = np.asarray(cutout)
    fabric = pixels[pixels[..., 3] > 200, :3]
    if not len(fabric):
        return ShirtPhoto(original, None)
    gray = 82 if np.median(fabric) >= 120 else 215
    pad = max(14, round(max(cutout.size) * 0.07))
    frame = Image.new("RGBA", (cutout.width + pad * 2, cutout.height + pad * 2), (gray, gray, gray, 255))
    frame.alpha_composite(cutout, (pad, pad))
    expected = None
    if reliable:
        expected = Image.new("L", frame.size)
        expected.paste(cutout.getchannel("A"), (pad, pad))
    return ShirtPhoto(frame, expected)


def bounded_photo(photo: ShirtPhoto) -> Image.Image:
    # Core rotates sleeves in a padded square. A uniform bound on the input
    # keeps large phone photos from allocating oversized intermediate images.
    image = photo.image.copy()
    image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    return image


def fit_product_shape(image: Image.Image, mask: np.ndarray, template: np.ndarray,
                      profile: str, shading: float, has_back: bool) -> str:
    """Use visible cuffs or straps when they disagree with the core arm length."""
    try:
        parts = fitted_top(*crop_silhouette(np.array(image.convert("RGBA")), mask))
        if parts is None:
            return profile
        measured_profile = "sleeveless" if parts.profile == "sleeveless" else "long_sleeve"
        if measured_profile == profile:
            return profile
        if measured_profile == "sleeveless":
            replacement = rgba(place_template("shirt", parts))
        else:
            replacement = np.zeros_like(template)
            for limb, face, texture in limb_textures(parts, FACES[LIMBS[0], "front"][3]):
                face_view(replacement, limb, face)[:] = texture
        replacement = autobash.apply_shading(replacement, shading)
    except PhotoError:
        return profile
    for part, face in FACES:
        if part in LIMBS or (measured_profile == "sleeveless" and (face != "back" or not has_back)):
            face_view(template, part, face)[:] = face_view(replacement, part, face)
    return measured_profile


def make_core_shirt(front: ShirtPhoto, back: ShirtPhoto | None, shading: float,
                    worn_cutout: bytes | None = None, *, fit_product: bool = True) -> tuple[bytes, str]:
    image = bounded_photo(front)
    with TemporaryDirectory(prefix="threadport-shirt-") as folder:
        path = Path(folder) / "front.png"
        image.save(path, format="PNG")
        back_path = None
        if back is not None:
            back_path = Path(folder) / "back.png"
            bounded_photo(back).save(back_path, format="PNG")
        with _render_lock:
            template, debug = autobash.make_shirt(path, back_path, shading)

    if front.expected is not None and "mask" in debug:
        expected = np.asarray(front.expected.resize(image.size, Image.Resampling.NEAREST)) > 200
        mask = debug["mask"]
        agreement = np.count_nonzero(mask & expected) / max(1, np.count_nonzero(mask | expected))
        if agreement < 0.50:
            raise PhotoError("The shirt model missed most of the visible fabric.")

    arms = debug["lm"]["arms"]
    profile = "long_sleeve" if any(arm["long"] for arm in arms.values()) else "t_shirt"
    if worn_cutout and recover_worn_template(worn_cutout, shading, template):
        profile = "t_shirt"
    elif fit_product and "mask" in debug:
        profile = fit_product_shape(image, debug["mask"], template, profile, shading, back is not None)
    landmarks = debug["lm"]
    if fit_product and back is None and profile != "sleeveless" and "mask" in debug and "scale" in landmarks:
        continue_fabric(template, np.asarray(image.convert("RGBA")), debug["mask"],
                        left=landmarks["x0"] + 2, top=landmarks["front_top"],
                        scale=landmarks["scale"], shading=shading)
    png = BytesIO()
    Image.fromarray(template).save(png, format="PNG", icc_profile=COLOR_PROFILE.tobytes())
    return png.getvalue(), profile
