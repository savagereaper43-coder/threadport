"""Render the sample photos through the same workflow as Auto Bash."""

import argparse
import asyncio
import base64
import json
import re
from pathlib import Path

from .processing import process_events

SAMPLES = Path(__file__).resolve().parents[1] / "samples"


async def run(files: list[Path], destination: Path) -> int:
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
                print(f"{source.name} → {output} ({template['profile']})")
            elif event["type"] == "error":
                print(f"{source.name}: {event['message']}")
                failures += 1
    return int(failures > 0)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("photos", nargs="*", type=Path)
    parser.add_argument("--output", type=Path, default=SAMPLES / "out")
    args = parser.parse_args()
    files = args.photos or sorted(path for path in SAMPLES.iterdir()
                                  if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
    return asyncio.run(run(files, args.output))


if __name__ == "__main__":
    raise SystemExit(main())
