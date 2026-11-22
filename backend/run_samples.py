"""Render the sample photos through the same workflow as Auto Bash."""

import argparse
import asyncio
import base64
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw

from .processing import process_events

SAMPLES = Path(__file__).resolve().parents[1] / "samples"


def save_review(template: Path) -> None:
    """Make an enlarged, checkerboard-backed copy for visual review."""
    with Image.open(template) as image:
        width, height = image.size
        enlarged = image.resize((2 * width, 2 * height), Image.Resampling.NEAREST)
    background = Image.new("RGB", enlarged.size, "#d6d6d6")
    grid = ImageDraw.Draw(background)
    step = 24
    for y in range(0, background.height, step):
        for x in range(0, background.width, step):
            if (x // step + y // step) % 2:
                grid.rectangle((x, y, x + step - 1, y + step - 1), fill="#bfbfbf")
    background.paste(enlarged, mask=enlarged.getchannel("A"))
    review = template.parent / "review"
    review.mkdir(exist_ok=True)
    background.save(review / template.with_suffix(".jpg").name, quality=92, subsampling=0)


async def run(files: list[Path], destination: Path, review: bool = False) -> int:
    destination.mkdir(parents=True, exist_ok=True)
    failures = 0
    for source in files:
        async for line in process_events("auto", [("front", source.read_bytes())]):
            event = json.loads(line)
            if event["type"] == "result":
                template = event["template"]
                name = re.sub(r"[^a-z0-9]+", "-", source.stem.lower()).strip("-")
                output = destination / f"{name}.png"
                output.write_bytes(base64.b64decode(template["png"]))
                if review:
                    save_review(output)
                print(f"{source.name} → {output} ({template['profile']}, "
                      f"{template['quality']['score']}% estimated match)")
            elif event["type"] == "error":
                print(f"{source.name}: {event['message']}")
                failures += 1
    return int(failures > 0)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("photos", nargs="*", type=Path)
    parser.add_argument("--output", type=Path, default=SAMPLES / "out")
    parser.add_argument("--review", action="store_true", help="save enlarged visual review copies")
    args = parser.parse_args()
    files = args.photos or sorted(path for path in SAMPLES.iterdir()
                                  if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
    return asyncio.run(run(files, args.output, args.review))


if __name__ == "__main__":
    raise SystemExit(main())
