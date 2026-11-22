import base64
import json
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

from autobash_core import autobash
from backend.placement import FACES
from backend.garment_parts import silhouette
from backend.photos import prepare_cutout
from backend.processing import inspect, process_events
from backend.quality import face_view
from backend.shirt_engine import fit_product_shape

SAMPLES = Path(__file__).resolve().parents[1] / "samples"


class ShirtEngineTests(unittest.IsolatedAsyncioTestCase):
    async def test_classic_shirt_calls_supplied_engine_with_originals_and_shading(self):
        photo = (SAMPLES / "black shirt test.JPG").read_bytes()
        paths = []
        template = np.zeros((559, 585, 4), np.uint8)
        template[200, 325] = [32, 64, 128, 255]

        def render(front_path, back_path, shading):
            with Image.open(front_path) as front, Image.open(back_path) as back:
                self.assertEqual(front.size, (352, 373))
                self.assertEqual(front.getextrema()[-1], (255, 255))
                self.assertEqual(front.tobytes(), back.tobytes())
            self.assertEqual(shading, 0.4)
            paths.extend((front_path, back_path))
            return template, {"lm": {"arms": {"rarm": {"long": True}, "larm": {"long": True}}}}

        with patch.object(autobash, "make_shirt", side_effect=render) as supplied_engine:
            events = [json.loads(line) async for line in process_events(
                "auto", [("front", photo), ("back", photo)], shading=0.4
            )]

        supplied_engine.assert_called_once()
        self.assertTrue(all(not path.exists() for path in paths))
        self.assertEqual(events[-1]["type"], "result", events[-1])
        payload = events[-1]["template"]
        self.assertEqual((payload["mode"], payload["profile"], payload["has_back"]),
                         ("shirt", "long_sleeve", True))
        with Image.open(BytesIO(base64.b64decode(payload["png"]))) as result:
            np.testing.assert_array_equal(np.asarray(result), template)

    async def test_classical_fallback_fills_shirt_faces_when_core_unavailable(self):
        photo = (SAMPLES / "black shirt test.JPG").read_bytes()
        with patch.object(autobash, "make_shirt", side_effect=OSError("model unavailable")), self.assertLogs(
            "backend.processing", level="WARNING"
        ):
            events = [json.loads(line) async for line in process_events("shirt", [("front", photo)])]
        self.assertEqual(events[-1]["type"], "result", events[-1])
        template = events[-1]["template"]
        self.assertFalse(template["has_back"])
        with Image.open(BytesIO(base64.b64decode(template["png"]))) as image:
            sheet = np.asarray(image)
        for side in ("front", "left", "right", "back", "up", "down"):
            self.assertTrue((face_view(sheet, "torso", side)[..., 3] == 255).all())
        self.assertEqual(sheet[0, 0, 3], 0)

    async def test_worn_tshirt_recovers_when_engine_misidentifies_long_sleeves(self):
        photo = (SAMPLES / "white shirt on body test.JPG").read_bytes()
        template = np.zeros((559, 585, 4), np.uint8)
        debug = {"lm": {"arms": {"rarm": {"long": True}, "larm": {"long": True}}}}
        with patch.object(autobash, "make_shirt", return_value=(template, debug)):
            events = [json.loads(line) async for line in process_events("auto", [("front", photo)])]

        self.assertEqual(events[-1]["type"], "result", events[-1])
        result = events[-1]["template"]
        self.assertEqual(result["profile"], "t_shirt")
        with Image.open(BytesIO(base64.b64decode(result["png"]))) as image:
            sheet = np.asarray(image)
        for limb in ("rightLimb", "leftLimb"):
            sleeve = face_view(sheet, limb, "front")
            self.assertTrue((sleeve[:36, :, 3] == 255).all())
            self.assertFalse(sleeve[60:, :, 3].any())

    async def test_model_mask_that_picks_only_lettering_recovers_blue_fabric(self):
        photo = (SAMPLES / "golden" / "blue-lettered-tee.jpg").read_bytes()

        def wrong_mask(path, _back, _shading):
            with Image.open(path) as source:
                mask = np.zeros((source.height, source.width), dtype=bool)
                mask[200:210, 250:310] = True
            return np.zeros((559, 585, 4), np.uint8), {"mask": mask}

        with patch.object(autobash, "make_shirt", side_effect=wrong_mask) as supplied_engine, self.assertLogs(
            "backend.processing", level="WARNING"
        ):
            events = [json.loads(line) async for line in process_events("auto", [("front", photo)])]
        supplied_engine.assert_called_once()
        self.assertEqual(events[-1]["type"], "result", events[-1])
        with Image.open(BytesIO(base64.b64decode(events[-1]["template"]["png"]))) as image:
            face = face_view(np.asarray(image), "torso", "front")
        self.assertTrue((face[..., 3] == 255).all())
        self.assertGreater(np.median(face[..., 2]), np.median(face[..., 0]) + 24)

    def test_visible_knit_cuffs_replace_the_cores_short_sleeves(self):
        data = (SAMPLES / "golden" / "green-knit.jpg").read_bytes()
        cutout, _ = prepare_cutout(*inspect(data), "shirt")
        pixels, mask = silhouette(cutout)
        template = np.zeros((559, 585, 4), np.uint8)
        profile = fit_product_shape(Image.fromarray(pixels), mask, template, "t_shirt", 0, False)
        self.assertEqual(profile, "long_sleeve")
        for limb in ("rightLimb", "leftLimb"):
            self.assertTrue((face_view(template, limb, "front")[105:, :, 3] == 255).all())
            self.assertTrue((face_view(template, limb, "down")[..., 3] == 255).all())

    def test_engine_template_matches_shared_faces(self):
        parts = {"rarm": "rightLimb", "larm": "leftLimb"}
        self.assertEqual(
            {(parts.get(part, part), face): box for (part, face), box in autobash.LAYOUT.items()},
            FACES,
        )
