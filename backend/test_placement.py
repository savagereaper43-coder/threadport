import unittest
from io import BytesIO
from pathlib import Path
from contextlib import ExitStack
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image, ImageDraw

from backend.garment_parts import segment_parts
from backend.photos import prepare_cutout
from backend.placement import REGIONS, RULES, body_layer, body_scale, place_template
from backend.processing import inspect

SAMPLES = Path(__file__).resolve().parents[1] / "samples"
FACE = {(region["part"], region["face"]): region for region in REGIONS}


def read_png(data: bytes) -> Image.Image:
    with Image.open(BytesIO(data)) as photo:
        return photo.copy()


def png(image: Image.Image) -> bytes:
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def face(image: Image.Image, part: str, side: str) -> Image.Image:
    r = FACE[part, side]
    return image.crop((r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]))


def build_sample(name: str) -> Image.Image:
    prepared, details = prepare_cutout(*inspect((SAMPLES / name).read_bytes()), "auto")
    mode = details["mode"]
    return read_png(place_template(mode, segment_parts(prepared, mode, details["garment_type"])))


class PlacementTests(unittest.TestCase):
    def test_required_faces_are_opaque_and_unused_parts_stay_clear(self):
        for name, short_sleeves in (("black shirt test.JPG", True), ("blue pants test.JPG", False)):
            with self.subTest(name=name):
                template = build_sample(name)
                self.assertEqual(template.size, (585, 559))
                self.assertTrue(template.info.get("icc_profile"))
                alpha = np.array(template.getchannel("A"))
                allowed = np.zeros(alpha.shape, dtype=bool)
                for r in REGIONS:
                    allowed[r["y"]:r["y"] + r["h"], r["x"]:r["x"] + r["w"]] = True
                self.assertFalse(alpha[~allowed].any())
                for side in ("front", "left", "right", "up", "down"):
                    self.assertEqual(face(template, "torso", side).getchannel("A").getextrema(), (255, 255))
                self.assertIsNone(face(template, "torso", "back").getbbox())
                coverage = round(128 * RULES["profiles"]["t_shirt"]["limb_height"]) if short_sleeves else 128
                for part in ("rightLimb", "leftLimb"):
                    for side in ("front", "right", "left", "back"):
                        limb = np.asarray(face(template, part, side).getchannel("A"))
                        self.assertTrue((limb[:coverage] == 255).all(), (part, side))
                        self.assertFalse(limb[coverage:].any(), (part, side))
                    self.assertEqual(face(template, part, "up").getchannel("A").getextrema(), (255, 255))
                    expected = (0, 0) if short_sleeves else (255, 255)
                    self.assertEqual(face(template, part, "down").getchannel("A").getextrema(), expected)

    def test_dark_shirt_cutout_contains_both_sleeves_hem_and_lettering(self):
        data = (SAMPLES / "black shirt test.JPG").read_bytes()
        cutout, details = prepare_cutout(*inspect(data), "auto")
        alpha = np.asarray(read_png(cutout).getchannel("A"))
        self.assertEqual(details["garment_type"], "t_shirt")
        for x, y in ((43, 122), (318, 126), (150, 321), (168, 136)):
            self.assertEqual(alpha[y, x], 255, (x, y))
        self.assertEqual(alpha[30, 18], 0)

    def test_torso_seams_retain_original_adjacent_texels_from_one_layer(self):
        data = (SAMPLES / "black shirt test.JPG").read_bytes()
        cutout, details = prepare_cutout(*inspect(data), "auto")
        parts = segment_parts(cutout, details["mode"], details["garment_type"])
        template = read_png(place_template("shirt", parts))
        scale = body_scale(parts, 128, 128)
        original = body_layer(parts, scale, 256, 256, 64, 128)[64:192]
        rendered = np.concatenate([np.asarray(face(template, "torso", name))
                                   for name in ("right", "front", "left")], axis=1)
        for x in (64, 192):
            continuous = (original[:, x - 1:x + 1, 3] == 255).all(axis=1)
            self.assertGreater(continuous.sum(), 10)
        observed = original[..., 3] == 255
        np.testing.assert_array_equal(rendered[observed], original[observed])

    def test_every_face_uses_similarity_transforms_or_unscaled_pixel_copies(self):
        original = cv2.warpAffine
        matrices = []

        def check(photo, transform, size, **options):
            axes = transform[:, :2]
            norms = axes.T @ axes
            np.testing.assert_allclose(norms, np.eye(2) * norms[0, 0], rtol=1e-7, atol=1e-10)
            matrices.append(transform)
            return original(photo, transform, size, **options)

        for name in ("black shirt test.JPG", "blue pants test.JPG", "golden/denim-skirt.jpg"):
            cutout, details = prepare_cutout(*inspect((SAMPLES / name).read_bytes()), "auto")
            mode, kind = details["mode"], details["garment_type"]
            matrices.clear()
            with ExitStack() as stack:
                stack.enter_context(patch.object(cv2, "warpAffine", side_effect=check))
                for owner, name in ((cv2, "resize"), (cv2, "warpPerspective"), (cv2, "remap"),
                                    (Image.Image, "resize"), (Image.Image, "transform")):
                    stack.enter_context(patch.object(owner, name, side_effect=AssertionError(
                        f"Use a similarity transform or copy real texels instead of {name}."
                    )))
                front = segment_parts(cutout, mode, kind)
                back = segment_parts(cutout, mode, kind, back=True, profile=front.profile)
                output = read_png(place_template(mode, front, back))
            self.assertGreaterEqual(len(matrices), 6)
            self.assertEqual(output.getchannel("A").getextrema(), (0, 255))
            for part in ("torso", "rightLimb", "leftLimb"):
                self.assertIsNotNone(face(output, part, "back").getbbox())

    def test_limb_wrap_uses_the_neighboring_front_edges(self):
        template = build_sample("blue pants test.JPG")
        for part in ("rightLimb", "leftLimb"):
            front = np.asarray(face(template, part, "front"), dtype=int)
            right = np.asarray(face(template, part, "right"), dtype=int)
            left = np.asarray(face(template, part, "left"), dtype=int)
            self.assertLess(np.abs(front[:, 0, :3] - right[:, -1, :3]).mean(), 5)
            self.assertLess(np.abs(front[:, -1, :3] - left[:, 0, :3]).mean(), 5)

    def test_fitted_skirt_uses_one_front_panel_and_covers_only_the_upper_legs(self):
        photo = (SAMPLES / "golden" / "denim-skirt.jpg").read_bytes()
        cutout, details = prepare_cutout(*inspect(photo), "auto")
        self.assertEqual((details["garment_type"], details["mode"]), ("skirt", "pants"))
        parts = segment_parts(cutout, details["mode"], details["garment_type"])
        self.assertEqual(parts.profile, "skirt")
        template = read_png(place_template("pants", parts))
        length = round(128 * RULES["profiles"]["skirt"]["limb_height"])
        for part in ("rightLimb", "leftLimb"):
            for side in ("front", "left", "right", "back"):
                alpha = np.asarray(face(template, part, side))[..., 3]
                self.assertTrue((alpha[:length] == 255).all(), (part, side))
                self.assertFalse(alpha[length:].any(), (part, side))
            self.assertIsNone(face(template, part, "down").getbbox())
        right = np.asarray(face(template, "rightLimb", "front"), dtype=np.int16)
        left = np.asarray(face(template, "leftLimb", "front"), dtype=np.int16)
        difference = np.abs(right[15:55, -1, :3] - left[15:55, 0, :3]).mean()
        self.assertLess(difference, 20)

    def test_back_view_preserves_avatar_side_and_is_only_used_when_supplied(self):
        photo = Image.new("RGBA", (300, 360))
        pen = ImageDraw.Draw(photo)
        pen.rectangle((65, 35, 235, 122), fill="#999999")
        pen.polygon([(65, 100), (146, 100), (130, 322), (40, 320)], fill="#da3010")
        pen.polygon([(150, 100), (235, 100), (260, 322), (174, 322)], fill="#1040da")
        source = png(photo)
        front = segment_parts(source, "pants", "pants")
        back = segment_parts(png(photo.transpose(Image.Transpose.FLIP_LEFT_RIGHT)),
                             "pants", "pants", back=True, profile=front.profile)
        template = read_png(place_template("pants", front, back))
        for part, rgb in (("rightLimb", (218, 48, 16)), ("leftLimb", (16, 64, 218))):
            for side in ("front", "back"):
                self.assertEqual(face(template, part, side).getpixel((32, 70)), (*rgb, 255))

    def test_long_sleeve_hoodie_and_shorts_use_separate_profiles(self):
        for hood in (False, True):
            top = Image.new("RGBA", (340, 390))
            pen = ImageDraw.Draw(top)
            pen.rectangle((110, 107, 229, 338), fill="#8845a8")
            pen.polygon([(110, 107), (145, 132), (61, 341), (22, 329)], fill="#bf482e")
            pen.polygon([(229, 107), (195, 132), (278, 341), (317, 329)], fill="#216287")
            if hood:
                pen.ellipse((126, 37, 213, 145), fill="#8845a8")
            parts = segment_parts(png(top), "shirt", "top")
            self.assertEqual(parts.profile, "hoodie" if hood else "long_sleeve")
            self.assertIn("rightLimb", parts.pieces)
            self.assertIn("leftLimb", parts.pieces)
            if hood:
                self.assertIn("hood", parts.pieces)
            output = read_png(place_template("shirt", parts))
            self.assertGreater(face(output, "rightLimb", "front").getpixel((32, 123))[3], 220)

        shorts = Image.new("RGBA", (320, 250))
        pen = ImageDraw.Draw(shorts)
        pen.rectangle((55, 35, 265, 112), fill="#205aaf")
        pen.rectangle((49, 112, 146, 197), fill="#205aaf")
        pen.rectangle((171, 112, 272, 197), fill="#205aaf")
        parts = segment_parts(png(shorts), "pants", "shorts")
        self.assertEqual(parts.profile, "shorts")
        output = read_png(place_template("pants", parts))
        self.assertEqual(face(output, "rightLimb", "front").getpixel((32, 90))[3], 0)

    def test_tshirt_mode_uses_only_the_512_square_front(self):
        prepared, _ = prepare_cutout(*inspect((SAMPLES / "black shirt test.JPG").read_bytes()), "t-shirt")
        parts = segment_parts(prepared, "t-shirt", "t_shirt")
        self.assertFalse(parts.pieces)
        template = read_png(place_template("t-shirt", parts))
        self.assertEqual(template.size, (512, 512))
        self.assertEqual(template.getpixel((256, 256))[3], 255)


if __name__ == "__main__":
    unittest.main()
