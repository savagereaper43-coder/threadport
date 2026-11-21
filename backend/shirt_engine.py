"""Adapt validated uploads and the Classic Shirt engine's array output."""

from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock

from PIL import Image

from autobash_core import autobash

from .photos import COLOR_PROFILE

# The engine loads a shared rembg session lazily. Serialize shirt renders
# so concurrent requests cannot initialize it twice or compete for CPU memory.
_render_lock = Lock()


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
