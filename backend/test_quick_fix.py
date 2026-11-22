import unittest
from base64 import b64decode, b64encode
from io import BytesIO
from pathlib import Path

import numpy as np
from fastapi import HTTPException
from PIL import Image, ImageCms

from backend.placement import CLASSIC_SIZE, FACES, LIMBS, SIDES, TSHIRT_SIZE
from backend.quality import face_view
from backend.quick_fix import Fixes, FixRequest, TemplateRequest, edit_png, find_graphics


def patterned_template():
    image = np.zeros((*CLASSIC_SIZE[::-1], 4), dtype=np.uint8)
    for part, side in FACES:
        face = face_view(image, part, side)
        y, x = np.indices(face.shape[:2])
        weave = (7 * x + 3 * y) % 43
        face[..., :3] = np.stack((62 + weave, 84 + weave, 110 + weave), axis=-1)
        face[..., 3] = 255
    return image


def encode(image):
    buffer = BytesIO()
    Image.fromarray(image).save(buffer, format="PNG")
    return b64encode(buffer.getvalue()).decode("ascii")


def apply(png, mode="shirt", **fixes):
    encoded = edit_png(FixRequest(png=png, mode=mode, fixes=Fixes(**fixes)))
    with Image.open(BytesIO(b64decode(encoded))) as result:
        return np.array(result), result.info.get("icc_profile")


class QuickFixTests(unittest.TestCase):
    def test_tone_styles_and_recolor_keep_alpha_size_and_srgb(self):
        base = patterned_template()
        face_view(base, "rightLimb", "front")[52:] = 0
        png = encode(base)
        edits = (
            {"sharpness": 70},
            {"brightness": 35},
            {"saturation": -75},
            {"color": {"source": "#536982", "target": "#9e415a"}},
            *({"style": style} for style in ("clean", "cartoon", "vintage", "grunge")),
        )
        for fixes in edits:
            with self.subTest(fixes=fixes):
                changed, profile = apply(png, **fixes)
                self.assertEqual(changed.shape, (*CLASSIC_SIZE[::-1], 4))
                np.testing.assert_array_equal(changed[..., 3], base[..., 3])
                self.assertFalse(np.array_equal(changed, base))
                self.assertFalse(changed[base[..., 3] == 0].any())
                self.assertEqual(ImageCms.getProfileName(BytesIO(profile)).strip(), "sRGB built-in")
        unchanged, _ = apply(png, style="realistic")
        np.testing.assert_array_equal(unchanged, base)

    def test_plain_and_regenerated_backs_only_change_the_back(self):
        base = patterned_template()
        back = face_view(base, "torso", "back")
        back[..., :3] = [20, 30, 40]
        face_view(base, "torso", "left")[..., 0] += 30
        png = encode(base)
        variants = [apply(png, "pants", **fixes)[0] for fixes in (
            {"plain_back": True}, {"back_version": 1}, {"back_version": 2},
        )]
        for variant in variants:
            self.assertTrue((face_view(variant, "torso", "back")[..., 3] == 255).all())
            for part, side in FACES:
                if (part, side) != ("torso", "back"):
                    np.testing.assert_array_equal(face_view(variant, part, side), face_view(base, part, side))
        self.assertEqual(len({face_view(variant, "torso", "back").tobytes() for variant in variants}), 3)

    def test_sleeve_presets_clone_at_template_scale_and_preserve_the_torso(self):
        base = patterned_template()
        for arm in LIMBS:
            for side in SIDES:
                face_view(base, arm, side)[41:] = 0
            face_view(base, arm, "down")[:] = 0
        png = encode(base)
        allowed = {tuple(pixel) for pixel in face_view(base, "rightLimb", "front")[:41].reshape(-1, 4)}
        for choice in ("auto", "short", "long", "none"):
            with self.subTest(choice=choice):
                changed, _ = apply(png, sleeves=choice)
                for face in ("front", "back", "left", "right", "up", "down"):
                    np.testing.assert_array_equal(face_view(changed, "torso", face), face_view(base, "torso", face))
                for arm in LIMBS:
                    for side in SIDES:
                        face = face_view(changed, arm, side)
                        length = {"none": 0, "auto": 41, "short": 52, "long": 128}[choice]
                        self.assertTrue((face[:length, :, 3] == 255).all())
                        self.assertFalse(face[length:].any())
                        self.assertLessEqual({tuple(pixel) for pixel in face[:length].reshape(-1, 4)}, allowed)
                    self.assertEqual(bool(face_view(changed, arm, "up").any()), choice != "none")
                    self.assertEqual(bool(face_view(changed, arm, "down").any()), choice == "long")

    def test_logo_removal_on_the_real_shirt_preserves_the_rest_of_the_template(self):
        path = Path(__file__).resolve().parent.parent / "samples" / "out" / "black-shirt-test.png"
        with Image.open(path) as template:
            before = np.array(template.convert("RGBA"))
        after, _ = apply(encode(before), remove_logo=True)
        np.testing.assert_array_equal(after[..., 3], before[..., 3])
        self.assertGreater(np.count_nonzero(after[..., :3] != before[..., :3]), 400)
        for part, side in FACES:
            if (part, side) != ("torso", "front"):
                original = face_view(before, part, side)
                modified = face_view(after, part, side)
                np.testing.assert_array_equal(modified[original[..., 3] > 0], original[original[..., 3] > 0])

    def test_graphic_check_finds_back_lettering_and_removal_preserves_the_front(self):
        base = patterned_template()
        back = face_view(base, "torso", "back")
        back[30:41, 42:89, :3] = (251, 247, 244)
        back[42:60, 60:69, :3] = (251, 247, 244)
        png = encode(base)
        matches = find_graphics(TemplateRequest(png=png, mode="shirt"))
        self.assertEqual([match["side"] for match in matches], ["back"])
        x, y, _, _ = FACES["torso", "back"]
        hit, = matches
        self.assertLessEqual(hit["x"], x + 62)
        self.assertLessEqual(hit["y"], y + 39)
        self.assertGreater(hit["x"] + hit["w"], x + 62)
        self.assertGreater(hit["y"] + hit["h"], y + 39)
        changed, _ = apply(png, remove_logo=True, logo_face="back")
        np.testing.assert_array_equal(changed[..., 3], base[..., 3])
        np.testing.assert_array_equal(face_view(changed, "torso", "front"), face_view(base, "torso", "front"))
        self.assertFalse(np.array_equal(face_view(changed, "torso", "back"), back))

    def test_square_graphic_keeps_its_alpha_and_classic_dimensions_are_rejected(self):
        graphic = np.zeros((*TSHIRT_SIZE[::-1], 4), dtype=np.uint8)
        graphic[20:240, 60:250] = (69, 85, 140, 200)
        png = encode(graphic)
        result, _ = apply(png, "t-shirt", brightness=35)
        np.testing.assert_array_equal(result[..., 3], graphic[..., 3])
        self.assertGreater(result[52, 90, 0], graphic[52, 90, 0])
        for mode, invalid in (("pants", png), ("t-shirt", "unreadable")):
            with self.subTest(mode=mode), self.assertRaises(HTTPException) as error:
                apply(invalid, mode)
            self.assertEqual(error.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
