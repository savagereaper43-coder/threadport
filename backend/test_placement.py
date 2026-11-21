import unittest
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from backend.garment_parts import segment_parts
from backend.photos import prepare_cutout
from backend.placement import REGIONS, RULES, place_template
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
    def test_plain_background_examples_fill_fronts_and_clear_unseen_areas(self):
        for name, short_sleeves in (("black shirt test.JPG", True), ("blue pants test.JPG", False)):
            with self.subTest(name=name):
                template = build_sample(name)
                self.assertEqual(template.size, (585, 559))
                self.assertTrue(template.info.get("icc_profile"))
                alpha = np.array(template.getchannel("A"))
                placed = np.zeros(alpha.shape, dtype=bool)
                for r in REGIONS:
                    placed[r["y"]:r["y"] + r["h"], r["x"]:r["x"] + r["w"]] = True
                self.assertFalse(alpha[~placed].any())
                self.assertGreater((np.asarray(face(template, "torso", "front"))[:, :, 3] > 230).mean(), 0.99)
                for part in ("torso", "rightLimb", "leftLimb"):
                    self.assertIsNone(face(template, part, "back").getbbox())
                for part in ("rightLimb", "leftLimb"):
                    limb = np.asarray(face(template, part, "front"))
                    coverage = round(128 * RULES["profiles"]["t_shirt"]["limb_height"]) if short_sleeves else 128
                    self.assertGreater((limb[:coverage, :, 3] > 230).mean(), 0.96)
                    self.assertFalse(limb[coverage:, :, 3].any())
                    if short_sleeves:
                        cuff = limb[coverage - 4:coverage].astype(int)
                        wood_tint = (cuff[:, :, 0] > cuff[:, :, 2] + 9) & (cuff[:, :, 3] > 180)
                        self.assertLess(wood_tint.mean(), 0.03)

    def test_wrap_uses_the_neighboring_front_edges(self):
        template = build_sample("blue pants test.JPG")
        for part in ("torso", "rightLimb", "leftLimb"):
            front = np.asarray(face(template, part, "front"), dtype=int)
            right = np.asarray(face(template, part, "right"), dtype=int)
            left = np.asarray(face(template, part, "left"), dtype=int)
            self.assertLess(np.abs(front[:, 0, :3] - right[:, -1, :3]).mean(), 5)
            self.assertLess(np.abs(front[:, -1, :3] - left[:, 0, :3]).mean(), 5)

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
            self.assertIn("rightLimb", parts.textures)
            self.assertIn("leftLimb", parts.textures)
            if hood:
                self.assertIn("hood", parts.textures)
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
        self.assertEqual(list(parts.textures), ["torso"])
        template = read_png(place_template("t-shirt", parts))
        self.assertEqual(template.size, (512, 512))
        self.assertEqual(template.getpixel((256, 256))[3], 255)


if __name__ == "__main__":
    unittest.main()
