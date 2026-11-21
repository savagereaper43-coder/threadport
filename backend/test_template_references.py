"""Verify face orientation and relative geometry against the supplied template JPEGs."""

import unittest
from pathlib import Path

import cv2
import numpy as np

from backend.placement import REGIONS

ROOT = Path(__file__).resolve().parents[1]
HUES = {
    "front": (-8, 9),
    "right": (40, 89),
    "left": (17, 38),
    "back": (95, 122),
    "up": (91, 113),
    "down": (8, 25),
}


class ReferenceLayoutTests(unittest.TestCase):
    def test_each_face_matches_both_roblox_reference_images(self):
        # The files are enlarged, cropped JPEGs. Register them to the shared
        # coordinate system using the torso front and limb front boundaries.
        for filename, (left, right, upper, limb_y) in (
            ("shirt tech.JPG", (283, 446, 86, 445)),
            ("pants tech.JPG", (277, 434, 85, 431)),
        ):
            image = cv2.imread(str(ROOT / filename))
            hue, sat, _ = cv2.split(cv2.cvtColor(image, cv2.COLOR_BGR2HSV))
            sx, sy = (right - left) / 128, (limb_y - upper) / (355 - 74)
            for r in REGIONS:
                name = (r["part"], r["face"])
                with self.subTest(reference=filename, face=name):
                    x, y, w, h = (r[k] for k in ("x", "y", "w", "h"))
                    a, b, c, d = map(round, (left + (x - 231) * sx, upper + (y - 74) * sy,
                                             left + (x + w - 231) * sx, upper + (y + h - 74) * sy))
                    ox, oy = max(0, a - 5), max(0, b - 5)
                    local = hue[oy:d + 5, ox:c + 5].astype(int)
                    lo, hi = HUES[r["face"]]
                    if r["face"] == "front":
                        local[local > 170] -= 180
                    color = (local >= lo) & (local <= hi) & (sat[oy:d + 5, ox:c + 5] > 145)
                    columns = np.flatnonzero(color.sum(axis=0) > (d - b) * 0.55) + ox
                    rows = np.flatnonzero(color.sum(axis=1) > (c - a) * 0.55) + oy
                    self.assertGreater(len(columns), 0)
                    self.assertGreater(len(rows), 0)
                    actual = (columns[0], rows[0], columns[-1] + 1, rows[-1] + 1)
                    for registered, observed in zip((a, b, c, d), actual):
                        self.assertLessEqual(abs(registered - observed), 3)


if __name__ == "__main__":
    unittest.main()
