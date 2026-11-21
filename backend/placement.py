"""Map photographed fabric to the exact shared Roblox template rectangles."""

import json
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps

from .garment_parts import GarmentParts
from .photos import COLOR_PROFILE

SHARED = Path(__file__).resolve().parents[1] / "shared"
REGIONS = json.loads((SHARED / "templateLayout.json").read_text(encoding="utf-8"))
RULES = json.loads((SHARED / "placement_rules.json").read_text(encoding="utf-8"))
FRONT_WIDTHS = {region["part"]: region["w"] for region in REGIONS if region["face"] == "front"}
CLASSIC_SIZE = (585, 559)
TSHIRT_SIZE = (512, 512)


def side_strip(front: Image.Image, back: Image.Image | None, side: str,
               fraction: float, size: tuple[int, int], front_width: int) -> Image.Image:
    width, height = front.size
    strip_width = round(width * fraction)
    right = side == "right_edge"
    edge = (0, 0, strip_width, height) if right else (width - strip_width, 0, width, height)
    front_edge = ImageOps.mirror(front.crop(edge))

    face = Image.new("RGBA", size)
    visible_width = size[0] if back is None else (size[0] + 1) // 2
    front_x = size[0] - visible_width if right else 0
    face.paste(front_edge.resize((visible_width, size[1]), Image.Resampling.LANCZOS), (front_x, 0))
    if back is not None:
        back_width, back_height = back.size
        depth = round(back_width * fraction)
        edge = (back_width - depth, 0, back_width, back_height) if right else (0, 0, depth, back_height)
        back_edge = ImageOps.mirror(back.crop(edge))
        back_x = 0 if right else visible_width
        face.paste(back_edge.resize((size[0] - visible_width, size[1]), Image.Resampling.LANCZOS),
                   (back_x, 0))

    # Sample the exact same texels at adjoining UV edges, including alpha.
    front_view = front.resize((front_width, size[1]), Image.Resampling.LANCZOS)
    seam_x = 0 if right else front_width - 1
    face_x = size[0] - 1 if right else 0
    face.paste(front_view.crop((seam_x, 0, seam_x + 1, size[1])), (face_x, 0))
    if back is not None:
        back_view = back.resize((front_width, size[1]), Image.Resampling.LANCZOS)
        seam_x = front_width - 1 if right else 0
        face.paste(back_view.crop((seam_x, 0, seam_x + 1, size[1])), (size[0] - 1 - face_x, 0))
    return face


def place_template(mode: str, front: GarmentParts, back: GarmentParts | None = None) -> bytes:
    if mode == "t-shirt":
        canvas = front.textures["torso"].resize(TSHIRT_SIZE, Image.Resampling.LANCZOS)
    else:
        canvas = Image.new("RGBA", CLASSIC_SIZE)
        profile = RULES["profiles"][front.profile]
        for region in REGIONS:
            part, face = region["part"], region["face"]
            material = front.textures.get(part)
            if material is None:
                continue
            reverse = back.textures.get(part) if back else None
            coverage = 1 if part == "torso" else profile["limb_height"]
            width, height = region["w"], region["h"]
            y = region["y"]
            mappings = profile.get("torso_faces", {}) if part == "torso" else {}
            source = mappings.get(face, RULES["faces"][face])
            if source == "bottom_edge" and coverage < 1:
                continue
            if face in ("front", "back", "left", "right"):
                height = max(1, round(height * coverage))
            size = (width, height)

            if source in ("right_edge", "left_edge"):
                patch = side_strip(material, reverse, source, profile["side_strip"], size, FRONT_WIDTHS[part])
            else:
                if source == "back":
                    if reverse is None:
                        continue
                    material = reverse
                elif source in ("top_edge", "bottom_edge", "hood"):
                    if source == "hood" and "hood" in front.textures:
                        material = front.textures["hood"]
                    else:
                        w, h = material.size
                        bottom = source == "bottom_edge"
                        fraction = profile["bottom_strip"] if bottom else profile["top_strip"]
                        strip_depth = round(h * fraction)
                        strip = material.crop((0, h - strip_depth, w, h) if bottom else (0, 0, w, strip_depth))
                        material = ImageOps.flip(strip)
                        # Project the photographed edge only as far as its observed depth.
                        # The rest of the cap is still unseen in a flat photo.
                        depth = min(height, max(1, round(128 * coverage * fraction)))
                        if not bottom:
                            y += height - depth
                        size = width, depth
                patch = material.resize(size, Image.Resampling.LANCZOS)
            canvas.paste(patch, (region["x"], y))

    output = BytesIO()
    canvas.save(output, format="PNG", icc_profile=COLOR_PROFILE.tobytes())
    return output.getvalue()
