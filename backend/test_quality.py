import unittest
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

from backend.fabric_pattern import pattern_fill
from backend.photos import prepare_cutout
from backend.placement import CLASSIC_SIZE, FACES
from backend.processing import inspect
from backend.quality import blend_seams, face_view, fill_unseen, finish_images, inspect_quality

SAMPLES = Path(__file__).resolve().parents[1] / "samples"


def sheet() -> np.ndarray:
    image = np.zeros((*CLASSIC_SIZE[::-1], 4), np.uint8)
    for key in FACES:
        face_view(image, *key)[:] = (70, 94, 130, 255)
    return image


class QualityTests(unittest.TestCase):
    def test_pattern_tiles_copy_pixels_at_original_repeat_interval(self):
        y, x = np.mgrid[:60, :60]
        source = np.full((60, 60, 4), 255, dtype=np.uint8)
        source[..., :3] = np.where(((y % 5 < 2) ^ (x % 6 < 3))[..., None], 49, 192)
        tiled = pattern_fill(source, (80, 92), 0)
        self.assertIsNotNone(tiled)
        np.testing.assert_array_equal(tiled[:-5], tiled[5:])
        np.testing.assert_array_equal(tiled[:, :-6], tiled[:, 6:])
        self.assertEqual(set(np.unique(tiled[..., 0])), {49, 192})
        self.assertIsNone(pattern_fill(np.full_like(source, 80), (20, 20), 0))
        seed = np.zeros_like(tiled)
        seed[:25, :31] = source[:25, :31]
        aligned = pattern_fill(source, seed.shape[:2], 0, seed)
        np.testing.assert_array_equal(aligned[:25, :31], seed[:25, :31])

    def test_edge_blending_preserves_alpha_gutters_and_face_interiors(self):
        image = sheet()
        face_view(image, "torso", "left")[:] = (102, 126, 162, 255)
        before = image.copy()
        blend_seams(image)
        np.testing.assert_array_equal(image[..., 3], before[..., 3])
        np.testing.assert_array_equal(image[0, 0], [0, 0, 0, 0])
        np.testing.assert_array_equal(face_view(image, "torso", "front")[64, 64],
                                      face_view(before, "torso", "front")[64, 64])
        np.testing.assert_array_equal(face_view(image, "torso", "front")[64, -1],
                                      face_view(image, "torso", "left")[64, 0])

    def test_pants_back_variants_fill_only_the_unobserved_back(self):
        template = sheet()
        face_view(template, "torso", "back")[:] = 0
        face_view(template, "rightLimb", "front")[:] = (82, 104, 133, 255)
        face_view(template, "leftLimb", "front")[:] = (53, 83, 126, 255)
        encoded = BytesIO()
        Image.fromarray(template).save(encoded, format="PNG")
        variants = fill_unseen(encoded.getvalue(), "pants", "pants", False)
        self.assertEqual(len(variants), 2)
        for candidate in variants:
            self.assertTrue((face_view(candidate, "torso", "back")[..., 3] == 255).all())
            np.testing.assert_array_equal(face_view(candidate, "torso", "front"),
                                          face_view(template, "torso", "front"))
        self.assertFalse(np.array_equal(variants[0], variants[1]))
        self.assertEqual(len(fill_unseen(encoded.getvalue(), "pants", "pants", True)), 1)

    def test_shading_art_respects_strength_and_transparency(self):
        original = Image.new("RGB", (80, 80), "#393c86")
        base = sheet()
        face_view(base, "rightLimb", "front")[64:] = 0
        no_shade, shade = base.copy(), base.copy()
        for template, strength in ((no_shade, 0), (shade, 1)):
            finish_images([template], "pants", "pants", strength, original)
            np.testing.assert_array_equal(template[..., 3], base[..., 3])
        self.assertFalse(np.array_equal(no_shade, shade))

    def test_confidence_flags_inferred_backs_and_worn_photos(self):
        image = sheet()
        clean, _ = inspect_quality(image, "shirt", "t_shirt", "flat_lay", False)
        worn, _ = inspect_quality(image, "shirt", "t_shirt", "worn", False)
        self.assertLess(worn["score"], clean["score"])
        self.assertIn("guessed", clean["regions"]["torso.back"]["note"])
        self.assertNotIn("rightLimb.down", clean["regions"])
        self.assertIn("person", worn["regions"]["torso.front"]["note"])

    def test_worn_pants_mask_removes_the_lit_hand_and_keeps_the_leg(self):
        photo = (SAMPLES / "black pants on body.JPG").read_bytes()
        cutout, details = prepare_cutout(*inspect(photo), "auto")
        self.assertEqual((details["mode"], details["photo_type"]), ("pants", "worn"))
        with Image.open(BytesIO(cutout)) as result:
            self.assertEqual(result.getpixel((257, 300))[3], 0)
            self.assertEqual(result.getpixel((168, 355))[3], 255)
