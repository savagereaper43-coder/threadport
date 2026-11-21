"""ThreadPort's foundation API."""

import json
from pathlib import Path

from fastapi import FastAPI

app = FastAPI(title="ThreadPort")
layout_path = Path(__file__).resolve().parents[1] / "shared" / "templateLayout.json"
template_layout = json.loads(layout_path.read_text(encoding="utf-8"))


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/template-layout")
def get_template_layout():
    """Return the shared face rectangles for classic shirts and pants."""
    return template_layout
