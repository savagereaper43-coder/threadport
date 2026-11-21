import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw

from backend.photos import PhotoError, classify, decode_photo, prepare_cutout, work_photo
from backend.processing import inspect

SAMPLES = Path(__file__).resolve().parents[1] / "samples"


class PhotoTests(unittest.TestCase):
    def test_grabcut_sample_photos(self):
        cases = {
            "black shirt test.JPG": ("t_shirt", "flat_lay", "shirt", (176, 200)),
            "blue pants test.JPG": ("pants", "flat_lay", "pants", (156, 135)),
            "white shirt on body test.JPG": ("t_shirt", "worn", "shirt", (202, 230)),
            "black pants on body.JPG": ("pants", "worn", "pants", (182, 185)),
        }
        with patch("backend.photos.rembg_masker", return_value=None):
            for name, (garment, photo_type, mode, inside) in cases.items():
                with self.subTest(photo=name):
                    args = inspect((SAMPLES / name).read_bytes())
                    png, details = prepare_cutout(*args, "auto")
                    self.assertEqual(details, {
                        "garment_type": garment, "photo_type": photo_type,
                        "mode": mode, "method": "grabcut",
                    })
                    with Image.open(BytesIO(png)) as cutout:
                        alpha = cutout.getchannel("A")
                        self.assertEqual(cutout.mode, "RGBA")
                        self.assertEqual(cutout.size, args[0].size)
                        self.assertEqual(alpha.getpixel((0, 0)), 0)
                        self.assertGreater(alpha.getpixel(inside), 220)
                        if mode == "pants" and photo_type == "flat_lay":
                            self.assertEqual(alpha.getpixel((166, 470)), 0)

    def test_existing_transparency_and_explicit_mode_are_preserved(self):
        photo = Image.new("RGBA", (100, 120))
        ImageDraw.Draw(photo).rectangle((25, 25, 75, 99), fill=(24, 63, 122, 219))
        png, details = prepare_cutout(photo, work_photo(photo), None, "t-shirt")
        self.assertEqual(details["method"], "existing_alpha")
        self.assertEqual(details["mode"], "t-shirt")
        with Image.open(BytesIO(png)) as cutout:
            self.assertEqual(cutout.getpixel((50, 50)), (24, 63, 122, 219))
            self.assertEqual(cutout.getpixel((0, 0)), (0, 0, 0, 0))

    def test_accepts_a_clothing_model_mask_and_falls_back_when_it_fails(self):
        photo, rgb, face = inspect((SAMPLES / "black shirt test.JPG").read_bytes())
        upper = Image.new("L", photo.size)
        ImageDraw.Draw(upper).rectangle((60, 40, 300, 320), fill=255)
        empty = Image.new("L", photo.size)
        with patch("backend.photos.rembg_masker", return_value=lambda image: [upper, empty, empty]):
            _, details = prepare_cutout(photo, rgb, face, "shirt")
            self.assertEqual(details["method"], "rembg")
        with patch("backend.photos.rembg_masker", return_value=lambda image: [empty, empty, empty]):
            _, details = prepare_cutout(photo, rgb, face, "shirt")
            self.assertEqual(details["method"], "grabcut")

    def test_recognizes_photo_shapes_beyond_the_sample_set(self):
        rgb = np.full((200, 200, 3), 245, dtype=np.uint8)
        mask = np.zeros((200, 200), dtype=bool)
        mask[20:130, 30:170] = True
        self.assertEqual(classify(rgb, mask, False)[1], "folded")

        mask[20:60, 80:120] = False
        mask[85:130, :60] = False
        mask[85:130, 140:] = False
        self.assertEqual(classify(rgb, mask, False)[1], "ghost_mannequin")

        mask[20:40] = False
        mask[25:40, 95:105] = True
        self.assertEqual(classify(rgb, mask, False)[1], "hanger_product")

        shorts = np.zeros((200, 200), dtype=bool)
        shorts[30:145, 25:175] = True
        shorts[90:145, 80:120] = False
        self.assertEqual(classify(rgb, shorts, False), ("shorts", "hanger_product", "pants"))

    def test_rejects_invalid_images_and_unusable_photos(self):
        with self.assertRaisesRegex(PhotoError, "readable JPG, PNG, or WebP"):
            decode_photo(b"not an image")
        photo = Image.new("RGBA", (90, 90), "#999999")
        with patch("backend.photos.rembg_masker", return_value=None):
            with self.assertRaisesRegex(PhotoError, "couldn't find the clothing"):
                prepare_cutout(photo, work_photo(photo), None, "auto")


if __name__ == "__main__":
    unittest.main()
