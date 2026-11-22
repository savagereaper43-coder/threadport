"""Upload validation and newline-delimited progress for photo preparation."""

import base64
import json
import logging
import os
from collections.abc import AsyncIterator
from io import BytesIO

import numpy as np
from PIL import Image

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from python_multipart.exceptions import MultipartParseError
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from autobash_core.autobash import apply_shading, clone_fill, graphic_mask

from .garment_parts import segment_parts
from .placement import place_template
from .photos import COLOR_PROFILE, PhotoError, decode_photo, find_face, prepare_cutout, work_photo
from .quality import fill_unseen, finish_images, review_templates
from .quality import face_view, rgba
from .shirt_engine import isnet_cutout, make_core_shirt, shirt_photo

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


async def read_photos(request: Request) -> tuple[str, list[tuple[str, bytes]], float]:
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "multipart/form-data":
        raise HTTPException(415, "Add a photo and try uploading again.")

    parser = MultiPartParser(request.headers, limited_body(request), max_files=5, max_fields=2, max_part_size=128)
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
                or set(form) - {"front", "back", "angles", "mode", "shading"}):
            raise HTTPException(422, "Add one main photo, an optional back photo and up to three more angles.")
        mode = form.get("mode", "auto")
        if not isinstance(mode, str) or mode not in MODES:
            raise HTTPException(422, "Choose Auto, Shirt, Pants or T-Shirt.")
        try:
            shading = float(form.get("shading", "1"))
        except (TypeError, ValueError):
            shading = -1
        if not 0 <= shading <= 1:
            raise HTTPException(422, "Choose a shading strength from 0% to 100%.")
        photos = []
        for role, files in fields.items():
            for upload in files:
                if not isinstance(upload, UploadFile):
                    raise HTTPException(422, "Choose JPG, PNG or WebP files to upload.")
                data = await upload.read(MAX_FILE_BYTES + 1)
                if len(data) > MAX_FILE_BYTES:
                    raise HTTPException(413, "Each photo must be 10 MB or smaller.")
                photos.append((role, data))
        return mode, photos, shading
    finally:
        await form.close()


def event(kind: str, **data) -> str:
    return json.dumps({"type": kind, **data}, separators=(",", ":")) + "\n"


def inspect(data: bytes):
    image = decode_photo(data)
    rgb = work_photo(image)
    return image, rgb, find_face(rgb)


def available_cutout(photo, rgb, face, mode):
    model_enabled = os.getenv("THREADPORT_CORE_MODEL", "1") != "0"
    try:
        prepared = prepare_cutout(photo, rgb, face, mode)
    except PhotoError as initial_error:
        if not model_enabled:
            raise
        try:
            return prepare_cutout(photo, rgb, face, mode, isnet_mask=isnet_cutout(rgb))
        except Exception:
            raise initial_error from None
    png, details = prepared
    if (not model_enabled or face is not None or details["photo_type"] != "worn"
            or details["method"] != "grabcut" or details["mode"] != "shirt"
            or details["garment_type"] != "top"):
        return prepared

    # The skin detector can mistake warm textiles for skin. A second cutout can restore
    # missing panels when it preserves the original garment and adds body fabric.
    try:
        candidate = prepare_cutout(photo, rgb, face, mode, isnet_mask=isnet_cutout(rgb))
        if candidate[1]["garment_type"] != "top" or candidate[1]["mode"] != "shirt":
            return prepared
        with Image.open(BytesIO(png)) as first, Image.open(BytesIO(candidate[0])) as second:
            size = (rgb.shape[1], rgb.shape[0])
            old = np.asarray(first.getchannel("A").resize(size, Image.Resampling.NEAREST)) > 200
            new = np.asarray(second.getchannel("A").resize(size, Image.Resampling.NEAREST)) > 200
        if new.sum() >= old.sum() * 1.42 and (old & new).sum() >= old.sum() * 0.89:
            return candidate
    except Exception:
        logger.debug("The follow-up cutout was unavailable.", exc_info=True)
    return prepared


def classical_shirt(source_photos, shading: float) -> tuple[bytes, str, bool]:
    front_png, details = source_photos["front"]
    front = segment_parts(front_png, "shirt", details["garment_type"], photo_type=details["photo_type"])
    back = None
    if "back" in source_photos:
        back_png, back_details = source_photos["back"]
        try:
            back = segment_parts(back_png, "shirt", back_details["garment_type"], back=True,
                                 profile=front.profile, photo_type=back_details["photo_type"])
        except PhotoError:
            pass
    canvas = rgba(place_template("shirt", front, back))
    if back is None and front.profile != "sleeveless":
        torso = face_view(canvas, "torso", "front")
        fabric = torso[..., 3] == 255
        rgb = np.ascontiguousarray(torso[..., :3])
        clean = clone_fill(rgb, graphic_mask(rgb, fabric), fabric)
        rear = face_view(canvas, "torso", "back")
        rear[..., :3] = clean[:, ::-1]
        rear[..., 3] = torso[:, ::-1, 3]
    output = BytesIO()
    Image.fromarray(apply_shading(canvas, shading)).save(output, format="PNG", icc_profile=COLOR_PROFILE.tobytes())
    return output.getvalue(), front.profile, back is not None


async def process_events(
    mode: str, photos: list[tuple[str, bytes]], shading: float = 1.0
) -> AsyncIterator[str]:
    try:
        yield event("progress", step="finding", percent=0)
        inspected = []
        decoded = {}
        for index, (role, data) in enumerate(photos):
            if data not in decoded:
                decoded[data] = await run_in_threadpool(inspect, data)
            inspected.append((role, decoded[data]))
            yield event("progress", step="finding", percent=20 * (index + 1) // len(photos))

        yield event("progress", step="removing", percent=20)
        source_photos = {}
        cutouts = {}
        for index, (role, image) in enumerate(inspected):
            key = id(image[0])
            if key not in cutouts:
                cutouts[key] = await run_in_threadpool(available_cutout, *image, mode)
            png, details = cutouts[key]
            if role in ("front", "back"):
                source_photos[role] = (png, details)
            yield event("photo", role=role, png=base64.b64encode(png).decode("ascii"), **details)
            yield event("progress", step="removing", percent=20 + 40 * (index + 1) // len(inspected))

        yield event("progress", step="cutting", percent=60)
        front_png, details = source_photos["front"]
        originals = {role: image[0] for role, image in inspected}
        original = originals["front"]
        template_mode, photo_type = details["mode"], details["photo_type"]
        if template_mode == "shirt":
            front = shirt_photo(original, front_png, photo_type)
            back = None
            if "back" in originals:
                back_png, back_details = source_photos["back"]
                back = shirt_photo(originals["back"], back_png, back_details["photo_type"])
            yield event("progress", step="placing", percent=85)
            if os.getenv("THREADPORT_CORE_MODEL", "1") == "0":
                template, profile, has_back = await run_in_threadpool(classical_shirt, source_photos, shading)
            else:
                try:
                    worn_tee = photo_type == "worn" and details["garment_type"] == "t_shirt"
                    template, profile = await run_in_threadpool(
                        make_core_shirt, front, back, shading, front_png if worn_tee else None,
                        fit_product=photo_type != "worn",
                    )
                    has_back = back is not None
                except Exception as error:
                    logger.warning("Shirt core could not render this photo (%s). Trying the classical path.", error)
                    template, profile, has_back = await run_in_threadpool(classical_shirt, source_photos, shading)
        else:
            front = await run_in_threadpool(
                segment_parts, front_png, template_mode, details["garment_type"], photo_type=photo_type
            )
            back = None
            if template_mode == "pants" and "back" in source_photos:
                png, details = source_photos["back"]
                try:
                    back = await run_in_threadpool(
                        segment_parts, png, template_mode, details["garment_type"], back=True,
                        profile=front.profile, photo_type=details["photo_type"]
                    )
                except PhotoError:
                    pass  # An unreadable back silhouette should not discard the front template.
            yield event("progress", step="placing", percent=85)
            template = await run_in_threadpool(place_template, template_mode, front, back)
            profile = front.profile
            has_back = back is not None
        yield event("progress", step="filling", percent=87)
        candidates = await run_in_threadpool(fill_unseen, template, template_mode, profile, has_back)
        yield event("progress", step="shading", percent=92)
        await run_in_threadpool(finish_images, candidates, template_mode, profile, shading, original)
        yield event("progress", step="checking", percent=97)
        reviewed = await run_in_threadpool(review_templates, candidates, template_mode, profile, photo_type, has_back, front_png)
        encoded = [{"png": base64.b64encode(data).decode("ascii"), "quality": quality} for data, quality in reviewed]
        yield event("result", percent=100, template={
            **encoded[0],
            "mode": template_mode,
            "profile": profile,
            "has_back": has_back,
            **({"alternate": encoded[1]} if len(encoded) > 1 else {}),
        })
    except PhotoError as error:
        yield event("error", message=str(error))
    except Exception:
        logger.exception("Photo preparation failed")
        yield event("error", message="We couldn't prepare this photo. Try again or choose another photo.")


@router.post("/process")
async def process(request: Request):
    mode, photos, shading = await read_photos(request)
    return StreamingResponse(
        process_events(mode, photos, shading),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.post("/cutout")
async def cutout(request: Request):
    """Prepare a source photo for Studio without running template placement."""
    mode, photos, _ = await read_photos(request)
    if len(photos) != 1:
        raise HTTPException(422, "Add one photo to cut out.")

    def prepare():
        return available_cutout(*inspect(photos[0][1]), mode)

    try:
        png, details = await run_in_threadpool(prepare)
    except PhotoError as error:
        raise HTTPException(422, str(error)) from error
    return {"png": base64.b64encode(png).decode("ascii"), **details}
