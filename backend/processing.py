"""Upload validation and newline-delimited progress for photo preparation."""

import base64
import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from python_multipart.exceptions import MultipartParseError
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from .garment_parts import segment_parts
from .placement import place_template
from .photos import PhotoError, decode_photo, find_face, prepare_cutout, work_photo

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_REQUEST_BYTES = 5 * MAX_FILE_BYTES + 64 * 1024
MODES = {"auto", "shirt", "pants", "t-shirt"}
router = APIRouter()
logger = logging.getLogger(__name__)


class UploadTooLarge(MultiPartException):
    pass


async def limited_body(request: Request) -> AsyncIterator[bytes]:
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_REQUEST_BYTES:
            raise UploadTooLarge("The upload is too large. Use photos up to 10 MB each.")
        yield chunk


async def read_photos(request: Request) -> tuple[str, list[tuple[str, bytes]]]:
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "multipart/form-data":
        raise HTTPException(415, "Add a photo and try uploading again.")

    parser = MultiPartParser(request.headers, limited_body(request), max_files=5, max_fields=1, max_part_size=128)
    try:
        form = await parser.parse()
    except UploadTooLarge as error:
        raise HTTPException(413, error.message) from error
    except (MultiPartException, MultipartParseError) as error:
        raise HTTPException(400, "Add one front photo, one back photo and up to three more angles.") from error

    try:
        fields = {"front": form.getlist("front"), "back": form.getlist("back"), "angles": form.getlist("angles")}
        if not fields["front"]:
            raise HTTPException(422, "Add the main photo first.")
        if (len(fields["front"]) != 1 or len(fields["back"]) > 1 or len(fields["angles"]) > 3
                or set(form) - {"front", "back", "angles", "mode"}):
            raise HTTPException(422, "Add one main photo, an optional back photo and up to three more angles.")
        mode = form.get("mode", "auto")
        if not isinstance(mode, str) or mode not in MODES:
            raise HTTPException(422, "Choose Auto, Shirt, Pants or T-Shirt.")
        photos = []
        for role, files in fields.items():
            for upload in files:
                if not isinstance(upload, UploadFile):
                    raise HTTPException(422, "Choose JPG, PNG or WebP files to upload.")
                data = await upload.read(MAX_FILE_BYTES + 1)
                if len(data) > MAX_FILE_BYTES:
                    raise HTTPException(413, "Each photo must be 10 MB or smaller.")
                photos.append((role, data))
        return mode, photos
    finally:
        await form.close()


def event(kind: str, **data) -> str:
    return json.dumps({"type": kind, **data}, separators=(",", ":")) + "\n"


def inspect(data: bytes):
    image = decode_photo(data)
    rgb = work_photo(image)
    return image, rgb, find_face(rgb)


async def process_events(mode: str, photos: list[tuple[str, bytes]]) -> AsyncIterator[str]:
    try:
        yield event("progress", step="finding", percent=0)
        inspected = []
        for index, (role, data) in enumerate(photos):
            inspected.append((role, await run_in_threadpool(inspect, data)))
            yield event("progress", step="finding", percent=20 * (index + 1) // len(photos))

        yield event("progress", step="removing", percent=20)
        source_photos = {}
        for index, (role, image) in enumerate(inspected):
            png, details = await run_in_threadpool(prepare_cutout, *image, mode)
            if role in ("front", "back"):
                source_photos[role] = (png, details["mode"], details["garment_type"])
            yield event("photo", role=role, png=base64.b64encode(png).decode("ascii"), **details)
            yield event("progress", step="removing", percent=20 + 40 * (index + 1) // len(inspected))

        yield event("progress", step="cutting", percent=60)
        png, template_mode, garment = source_photos["front"]
        front = await run_in_threadpool(segment_parts, png, template_mode, garment)
        back = None
        if template_mode != "t-shirt" and "back" in source_photos:
            png, _, garment = source_photos["back"]
            try:
                back = await run_in_threadpool(
                    segment_parts, png, template_mode, garment, back=True, profile=front.profile
                )
            except PhotoError:
                pass  # An unreadable back silhouette should not discard the front template.

        yield event("progress", step="placing", percent=85)
        template = await run_in_threadpool(place_template, template_mode, front, back)
        yield event("result", percent=100, template={
            "png": base64.b64encode(template).decode("ascii"),
            "mode": template_mode,
            "profile": front.profile,
            "has_back": back is not None,
        })
    except PhotoError as error:
        yield event("error", message=str(error))
    except Exception:
        logger.exception("Photo preparation failed")
        yield event("error", message="We couldn't prepare this photo. Try again or choose another photo.")


@router.post("/process")
async def process(request: Request):
    mode, photos = await read_photos(request)
    return StreamingResponse(
        process_events(mode, photos),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
