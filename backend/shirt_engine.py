"""Adapt validated uploads and the Classic Shirt engine's array output."""

from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock

import numpy as np
from PIL import Image

from autobash_core import autobash

from .photos import COLOR_PROFILE

# The engine loads a shared rembg session lazily. Serialize shirt renders
# so concurrent requests cannot initialize it twice or compete for CPU memory.
_render_lock = Lock()


def shirt_photo(original: Image.Image, cutout_png: bytes, photo_type: str) -> Image.Image:
    if photo_type != "worn":
        return original
    # The core's input convention is a garment on a plain background.
    # Present the upstream worn-photo cutout on a high-contrast neutral matte.
    with Image.open(BytesIO(cutout_png)) as source:
        box = source.getbbox()
        cutout = source.crop(box).convert("RGBA") if box else source.convert("RGBA")
    pixels = np.asarray(cutout)
    fabric = pixels[pixels[..., 3] > 200, :3]
    if not len(fabric):
        return original
    gray = 82 if np.median(fabric) >= 120 else 215
    pad = max(14, round(max(cutout.size) * 0.07))
    frame = Image.new("RGBA", (cutout.width + pad * 2, cutout.height + pad * 2), (gray, gray, gray, 255))
    frame.alpha_composite(cutout, (pad, pad))
    return frame


def make_core_shirt(front: Image.Image, back: Image.Image | None, shading: float) -> tuple[bytes, str]:
    with TemporaryDirectory(prefix="threadport-shirt-") as folder:
        path = Path(folder) / "front.png"
        front.save(path, format="PNG")
        back_path = None
        if back is not None:
            back_path = Path(folder) / "back.png"
            back.save(back_path, format="PNG")
        with _render_lock:
            template, debug = autobash.make_shirt(path, back_path, shading)

    arms = debug["lm"]["arms"]
    profile = "long_sleeve" if any(arm["long"] for arm in arms.values()) else "t_shirt"
    png = BytesIO()
    Image.fromarray(template).save(png, format="PNG", icc_profile=COLOR_PROFILE.tobytes())
    return png.getvalue(), profile
