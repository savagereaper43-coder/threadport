"""Render the sample photos through the same workflow as Auto Bash."""

import argparse
import asyncio
import base64
import json
import re
from time import perf_counter
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


async def run(files: list[Path], destination: Path, review: bool = False, summary: Path | None = None) -> int:
    destination.mkdir(parents=True, exist_ok=True)
    failures = 0
    results = []
    for source in files:
        name = re.sub(r"[^a-z0-9]+", "-", source.stem.lower()).strip("-")
        output = destination / f"{name}.png"
        began = perf_counter()
        row = {"sample": source.name, "id": name}
        async for line in process_events("auto", [("front", source.read_bytes())]):
            event = json.loads(line)
            if event["type"] == "photo":
                row.update({key: event[key] for key in ("photo_type", "garment_type", "method")})
            elif event["type"] == "result":
                template = event["template"]
                output.write_bytes(base64.b64decode(template["png"]))
                if review:
                    save_review(output)
                row.update(mode=template["mode"], profile=template["profile"], estimate=template["quality"]["score"])
                print(f"{source.name} → {output} ({template['profile']}, "
                      f"{template['quality']['score']}% estimated match)", flush=True)
            elif event["type"] == "error":
                row["error"] = event["message"]
                print(f"{source.name}: {event['message']}", flush=True)
                failures += 1
        row["seconds"] = round(perf_counter() - began, 3)
        results.append(row)
    if summary:
        summary.parent.mkdir(parents=True, exist_ok=True)
        summary.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    return int(failures > 0)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("photos", nargs="*", type=Path)
    parser.add_argument("--output", type=Path, default=SAMPLES / "out")
    parser.add_argument("--review", action="store_true", help="save enlarged visual review copies")
    parser.add_argument("--summary", type=Path, help="write the render outcomes and timings as JSON")
    args = parser.parse_args()
    files = args.photos or sorted(path for folder in (SAMPLES, SAMPLES / "golden") if folder.is_dir()
                                  for path in folder.iterdir()
                                  if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
    return asyncio.run(run(files, args.output, args.review, args.summary))


if __name__ == "__main__":
    raise SystemExit(main())
