"""ThreadPort's API."""

from fastapi import FastAPI

from .placement import REGIONS
from .processing import router as processing_router

app = FastAPI(title="ThreadPort")
app.include_router(processing_router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/template-layout")
def get_template_layout():
    """Return the shared face rectangles for classic shirts and pants."""
    return REGIONS
