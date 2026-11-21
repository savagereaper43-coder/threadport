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
from backend.processing import process_events

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

    def test_engine_template_matches_shared_faces(self):
        parts = {"rarm": "rightLimb", "larm": "leftLimb"}
        self.assertEqual(
            {(parts.get(part, part), face): box for (part, face), box in autobash.LAYOUT.items()},
            FACES,
        )
