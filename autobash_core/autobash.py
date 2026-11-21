"""ThreadPort Auto Bash prototype: photo of a top on a plain background -> Roblox Classic Shirt template.

Photobash rules: only uniform scaling and rotation, real photo pixels, mirror/clone fill. Never stretch.
Usage: python autobash.py input.jpg out_dir [--back back.jpg]
"""
import sys, os, json
import numpy as np, cv2
from PIL import Image

# ---- Roblox Classic Shirt template (585x559). Character's right = viewer's left. ----
W_T, H_T = 585, 559
LAYOUT = {
    ("torso", "up"): (231, 8, 128, 64), ("torso", "right"): (165, 74, 64, 128),
    ("torso", "front"): (231, 74, 128, 128), ("torso", "left"): (361, 74, 64, 128),
    ("torso", "back"): (427, 74, 128, 128), ("torso", "down"): (231, 204, 128, 64),
    ("rarm", "up"): (217, 289, 64, 64), ("rarm", "left"): (19, 355, 64, 128),
    ("rarm", "back"): (85, 355, 64, 128), ("rarm", "right"): (151, 355, 64, 128),
    ("rarm", "front"): (217, 355, 64, 128), ("rarm", "down"): (217, 485, 64, 64),
    ("larm", "up"): (308, 289, 64, 64), ("larm", "front"): (308, 355, 64, 128),
    ("larm", "left"): (374, 355, 64, 128), ("larm", "back"): (440, 355, 64, 128),
    ("larm", "right"): (506, 355, 64, 128), ("larm", "down"): (308, 485, 64, 64),
}

_session = None


def get_mask(rgb):
    """Garment mask: AI cutout, refined against the plain background colour."""
    global _session
    from rembg import remove, new_session
    if _session is None:
        _session = new_session("isnet-general-use")
    m = np.array(remove(Image.fromarray(rgb), session=_session, only_mask=True)) > 128
    # Plain-background refinement: drop pixels that match the border colour (gaps between sleeves etc.)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    outside = cv2.erode((~m).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    bg = np.median(lab[outside], 0)
    core = cv2.erode(m.astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
    garment = np.median(lab[core], 0)
    axis_v = garment - bg
    if np.linalg.norm(axis_v) > 25:  # background clearly different from the garment
        t = ((lab - bg) @ axis_v) / (axis_v @ axis_v)  # 0 = background colour, 1 = garment colour
        smooth = cv2.GaussianBlur(t.astype(np.float32), (0, 0), 3)
        cand = (smooth < 0.45) & m
        cand = cv2.morphologyEx(cand.astype(np.uint8), cv2.MORPH_OPEN, np.ones((15, 15), np.uint8)) > 0
        # only remove large background-coloured areas that connect to the real background (e.g. gap between sleeves)
        n, lbl = cv2.connectedComponents(cand.astype(np.uint8))
        touch = set(np.unique(lbl[cv2.dilate((~m).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0]))
        for k in range(1, n):
            if k in touch and (lbl == k).sum() > 0.01 * m.size:
                m &= lbl != k
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(m)
    m = lbl == (1 + np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    # fill interior holes (not ones touching the image border)
    inv = (~m).astype(np.uint8)
    n, lbl = cv2.connectedComponents(inv)
    edge = set(np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]])))
    for k in range(1, n):
        if k not in edge and (lbl == k).sum() < 0.02 * m.size:
            m[lbl == k] = True
    return m


def runs(row):
    xs = np.flatnonzero(row)
    if len(xs) == 0:
        return []
    cut = np.flatnonzero(np.diff(xs) > 1)
    starts = np.r_[xs[0], xs[cut + 1]]
    ends = np.r_[xs[cut], xs[-1]]
    return list(zip(starts, ends))


def landmarks(m):
    """Find body edges (x0,x1), top, hem, armpit and garment style from the silhouette."""
    ys = np.flatnonzero(m.any(1))
    top, bot = ys[0], ys[-1]
    H = bot - top
    cx = int(np.mean(np.flatnonzero(m[top + int(0.5 * H)])))
    rows = {y: runs(m[y]) for y in range(top, bot + 1)}
    # Case A: sleeves hang down past the hem (centre empty while sides still have fabric)
    hem = None
    def hanging(y):
        r = rows[y]
        return (len(r) >= 2 and not m[y, cx] and r[0][1] < cx < r[-1][0]
                and r[0][1] - r[0][0] > 0.08 * H and r[-1][1] - r[-1][0] > 0.08 * H)
    need = max(5, int(0.06 * H))
    for y in range(top + int(0.4 * H), bot - need):
        if all(hanging(yy) for yy in range(y, y + need)):
            hem = y
            break
    if hem is not None:
        below = [rows[y] for y in range(hem, bot + 1) if len(rows[y]) >= 2]
        x0 = int(np.median([r[0][1] for r in below]))
        x1 = int(np.median([r[-1][0] for r in below]))
        style, armpit = "long_hanging", top + int(0.08 * H)
    else:
        hem = bot
        w = np.array([(rows[y][-1][1] - rows[y][0][0]) if rows[y] else 0 for y in range(top, bot + 1)])
        ymax = int(np.argmax(w[: int(0.6 * H)]))
        low = np.median(w[int(0.6 * H): int(0.9 * H)])
        armpit = None
        for i in range(ymax, int(0.8 * H)):
            if w[i] < w[ymax] - 0.7 * (w[ymax] - low):
                armpit = top + i
                break
        if armpit is None or w[ymax] - low < 0.08 * low:
            armpit = top + int(0.3 * H)
        body_rows = range(armpit + int(0.08 * H), top + int(0.85 * H))
        x0 = int(np.median([rows[y][0][0] for y in body_rows]))
        x1 = int(np.median([rows[y][-1][1] for y in body_rows]))
        style = "sleeves_out"
    return dict(top=int(top), hem=int(hem), x0=x0, x1=x1, armpit=int(armpit), style=style, cx=cx)


def reflect_fill(img, valid, axis):
    """Fill invalid pixels by mirroring real fabric from the nearest valid run (no stretching)."""
    out = img.copy()
    v = valid.copy()
    if axis == 1:
        out, v = out.transpose(1, 0, 2), v.T
    out = out.copy(); v = v.copy()
    for i in range(out.shape[0]):
        col = v[i]
        idx = np.flatnonzero(col)
        if len(idx) == 0:
            continue
        a, b = idx[0], idx[-1]
        seg = out[i, a:b + 1].copy()
        L = len(seg)
        for j in range(a - 1, -1, -1):  # before
            k = (a - 1 - j) % (2 * L)
            k = k if k < L else 2 * L - 1 - k
            out[i, j] = seg[k]
        for j in range(b + 1, out.shape[1]):  # after
            k = (j - b - 1) % (2 * L)
            k = k if k < L else 2 * L - 1 - k
            out[i, j] = seg[L - 1 - k]
        # interior holes in this line: copy from the previous valid pixel run (mirror)
        holes = np.flatnonzero(~col[a:b + 1]) + a
        for j in holes:
            src = 2 * (j - 1) - j if j - 1 >= a else j + 1
            out[i, j] = out[i, max(a, min(b, src))]
    if axis == 1:
        out = out.transpose(1, 0, 2)
    return out


def graphic_mask(rgb, body):
    """Prints/text = pixels that differ strongly from the smooth local fabric colour."""
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    k = max(15, (min(rgb.shape[:2]) // 6) | 1)
    base = np.dstack([cv2.medianBlur(np.ascontiguousarray(lab[..., c]).astype(np.uint8), k) for c in range(3)]).astype(np.float32)
    dL = np.abs(lab[..., 0] - base[..., 0])
    dC = np.linalg.norm(lab[..., 1:] - base[..., 1:], axis=2)
    inner = cv2.erode(body.astype(np.uint8), np.ones((17, 17), np.uint8)) > 0
    L8 = np.ascontiguousarray(lab[..., 0]).astype(np.uint8)
    ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    thin = (cv2.morphologyEx(L8, cv2.MORPH_BLACKHAT, ker) > 50) | (cv2.morphologyEx(L8, cv2.MORPH_TOPHAT, ker) > 50)
    g = ((dL > 55) | (dC > 18) | thin) & inner
    g = cv2.morphologyEx(g.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    # grow into faint parts of the same print (thin swashes, light edges) near what was found
    near = cv2.dilate(g, np.ones((31, 31), np.uint8)) > 0
    sL = lab[..., 0] - base[..., 0]
    if (g > 0).sum() > 30:
        sign = np.sign(np.median(sL[g > 0])) or 1.0
        noise = 1.4826 * np.median(np.abs(sL[inner & ~(g > 0)])) + 1
        faint = (sign * sL > max(15, 3.5 * noise)) & near & inner
    else:
        faint = np.zeros_like(inner)
    g = (g > 0) | faint
    g = cv2.dilate(g.astype(np.uint8), np.ones((13, 13), np.uint8)) > 0
    g = cv2.morphologyEx(g.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8)) > 0
    return g & body


def clone_fill(rgb, hole, valid, tile=32):
    """Clone-stamp: cover each hole tile with a nearby patch of clean fabric (soft-edged copy, no letters can leak)."""
    H, W = hole.shape
    out = _row_mirror(rgb, hole, valid)          # print-free base underneath
    ok = valid & ~cv2.dilate(hole.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
    offs = [(dx, dy) for dy in range(-200, 201, 5) for dx in range(-200, 201, 5) if abs(dx) + abs(dy) >= 10]
    offs.sort(key=lambda o: o[0] ** 2 + o[1] ** 2)
    ys, xs = np.nonzero(hole)
    if len(ys) == 0:
        return rgb.copy()
    acc = out.astype(np.float32)
    for ty in range(ys.min() // tile * tile, ys.max() + 1, tile):
        for tx in range(xs.min() // tile * tile, xs.max() + 1, tile):
            t = np.zeros_like(hole); t[ty:ty + tile, tx:tx + tile] = True
            t &= hole
            if not t.any():
                continue
            ext = cv2.dilate(t.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
            yy, xx = np.nonzero(ext)
            for dx, dy in offs:
                if yy.min() + dy < 0 or yy.max() + dy >= H or xx.min() + dx < 0 or xx.max() + dx >= W:
                    continue
                if ok[yy + dy, xx + dx].all():
                    # soft edge: full strength inside the hole, fading over the 4px rim
                    dist = cv2.distanceTransform(ext.astype(np.uint8), cv2.DIST_L2, 3)
                    al = np.clip(dist / 4.0, 0, 1)[yy, xx][:, None]
                    al = np.where(hole[yy, xx][:, None], np.maximum(al, 0.85), al)
                    donor = rgb[yy + dy, xx + dx].astype(np.float32)
                    acc[yy, xx] = donor * al + acc[yy, xx] * (1 - al)
                    break
    return np.clip(acc, 0, 255).astype(np.uint8)


def _row_mirror(rgb, hole, valid):
    out = rgb.copy()
    for y in np.flatnonzero(hole.any(1)):
        good = np.flatnonzero(valid[y] & ~hole[y])
        if len(good) < 4:
            continue
        for a, b in runs(hole[y]):
            left = good[good < a][::-1]; right = good[good > b]
            n = b - a + 1
            for i, x in enumerate(range(a, b + 1)):
                use_left = (i < n / 2 and len(left)) or not len(right)
                pool = left if use_left else right
                k = i if use_left else (b - x)
                period = 2 * len(pool); k = k % period
                k = k if k < len(pool) else period - 1 - k
                out[y, x] = rgb[y, pool[k]]
    return out


def inpaint(rgb, hole):
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    dst = np.zeros_like(bgr)
    try:
        cv2.xphoto.inpaint(bgr, (~hole).astype(np.uint8), dst, cv2.xphoto.INPAINT_FSR_FAST)
    except Exception:
        dst = cv2.inpaint(bgr, hole.astype(np.uint8), 5, cv2.INPAINT_TELEA)
    return cv2.cvtColor(dst, cv2.COLOR_BGR2RGB)


def crop(img, x, y, w, h):
    """Crop with edge padding so boxes can extend past the photo."""
    H, W = img.shape[:2]
    pad = int(max(w, h)) + 2
    p = cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_REFLECT)
    x, y = int(round(x)) + pad, int(round(y)) + pad
    return p[y:y + int(round(h)), x:x + int(round(w))]


def to_face(src, fw, fh):
    """Uniform scale only: src box was already cut at the face aspect ratio."""
    out = cv2.resize(src, (fw, fh), interpolation=cv2.INTER_AREA)
    blur = cv2.GaussianBlur(out, (0, 0), 0.8)
    return cv2.addWeighted(out, 1.35, blur, -0.35, 0)


def _g(n, c, w):
    x = np.arange(n, dtype=np.float32)
    return np.exp(-((x - c) / max(w, 1e-3)) ** 2)


def shading_maps(w, h, kind):
    """Professional-style fold/edge shading for one face. Returns (darken multiplier, highlight amount)."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xx / (w - 1), yy / (h - 1)
    dark = np.zeros((h, w), np.float32)
    hi = np.zeros((h, w), np.float32)
    edge = np.minimum(u, 1 - u)
    if kind == "front" or kind == "back":
        dark += 0.55 * np.exp(-edge / 0.07)                      # rolls off at the sides
        dark += 0.35 * np.exp(-(1 - v) / 0.08)                   # hem
        for sx in (0.0, 1.0):                                     # armpit folds sweeping in from the sides
            ax = np.abs(u - sx)
            fold = np.exp(-((v - 0.42 - 0.35 * ax) / 0.05) ** 2) * np.exp(-ax / 0.22)
            dark += 0.45 * fold
        dark += 0.25 * np.exp(-((u - 0.5) / 0.05) ** 2) * np.exp(-((v - 0.78) / 0.18) ** 2) * (kind == "back")
        hi += 0.10 * np.exp(-(((u - 0.5) / 0.32) ** 2 + ((v - 0.25) / 0.2) ** 2))   # chest / shoulder blades
    elif kind == "side":
        dark += 0.22                                              # sides get less light
        dark += 0.55 * np.exp(-v / 0.18)                          # under the armpit
        dark += 0.30 * np.exp(-edge / 0.12)
    elif kind == "up":
        hi += 0.10
        dark += 0.30 * np.exp(-np.minimum(v, 1 - v) / 0.10)
    elif kind == "down":
        dark += 0.35
    elif kind in ("arm_front", "arm_back", "arm_out", "arm_in"):
        dark += 0.45 * np.exp(-edge / 0.10)
        dark += {"arm_front": 0.0, "arm_out": 0.05, "arm_back": 0.15, "arm_in": 0.30}[kind]
        dark += 0.30 * np.exp(-v / 0.06)                          # shoulder seam
        hi += 0.08 * np.exp(-((u - 0.5) / 0.25) ** 2) * (kind in ("arm_front", "arm_out"))
    elif kind == "arm_up":
        hi += 0.12
    elif kind == "arm_down":
        dark += 0.35
    return dark, hi


FACE_KIND = {
    ("torso", "front"): "front", ("torso", "back"): "back", ("torso", "left"): "side", ("torso", "right"): "side",
    ("torso", "up"): "up", ("torso", "down"): "down",
    ("rarm", "front"): "arm_front", ("rarm", "back"): "arm_back", ("rarm", "right"): "arm_out", ("rarm", "left"): "arm_in",
    ("larm", "front"): "arm_front", ("larm", "back"): "arm_back", ("larm", "left"): "arm_out", ("larm", "right"): "arm_in",
    ("rarm", "up"): "arm_up", ("larm", "up"): "arm_up", ("rarm", "down"): "arm_down", ("larm", "down"): "arm_down",
}


def apply_shading(tpl, strength=1.0):
    """Multiply-style shadows + screen-style highlights, adapted to how light/dark the fabric is."""
    out = tpl.copy()
    for key, (x, y, w, h) in LAYOUT.items():
        a = tpl[y:y + h, x:x + w, 3]
        if a.max() == 0:
            continue
        rgb = tpl[y:y + h, x:x + w, :3].astype(np.float32)
        lum = rgb.mean() / 255
        dark, hi = shading_maps(w, h, FACE_KIND[key])
        d_amt = 0.30 * strength * (0.6 + 0.4 * lum)          # shadows show less on dark fabric...
        h_amt = strength * (0.35 + 0.35 * (1 - lum))      # gentle sheen; never a grey haze
        res = rgb * (1 - np.clip(dark * d_amt, 0, 0.6))[..., None]
        res = res + (255 - res) * np.clip(hi * h_amt, 0, 0.35)[..., None]
        out[y:y + h, x:x + w, :3] = np.clip(res, 0, 255).astype(np.uint8)
    return out


def sleeve_band(rgb, m, side, lm):
    """Rotate one sleeve upright (shoulder at top). Return the clean inner fabric band, its validity and length."""
    x0, x1, top = lm["x0"], lm["x1"], lm["top"]
    sm = np.zeros_like(m)
    if lm["style"] == "long_hanging":
        lim = m.shape[0]
    else:
        lim = lm["armpit"] + int(0.1 * (lm["hem"] - top))
    if side == "photo_left":
        sm[:lim, :x0] = m[:lim, :x0]
    else:
        sm[:lim, x1:] = m[:lim, x1:]
    n, lbl, st, _ = cv2.connectedComponentsWithStats(sm.astype(np.uint8))
    if n < 2:
        return None
    sm = lbl == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
    pts = np.column_stack(np.nonzero(sm))[:, ::-1].astype(np.float32)  # x,y
    c = pts.mean(0)
    seam_x = x0 if side == "photo_left" else x1
    if lm["style"] == "long_hanging":
        axis = np.array([0.0, 1.0])  # sleeve hangs straight down
    else:
        # the cuff = the long convex-hull edge farthest from the body; sleeve axis is perpendicular to it
        cnts, _ = cv2.findContours(sm.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        hull = cv2.approxPolyDP(cv2.convexHull(max(cnts, key=cv2.contourArea)), 3, True)[:, 0, :].astype(np.float32)
        dmax = np.abs(pts[:, 0] - seam_x).max()
        best, axis = -1, None
        for i in range(len(hull)):
            p, q = hull[i], hull[(i + 1) % len(hull)]
            ln = np.linalg.norm(q - p)
            md = abs((p[0] + q[0]) / 2 - seam_x) / (dmax + 1e-6)
            score = ln * md ** 2
            if md > 0.45 and score > best:
                d = (q - p) / (ln + 1e-6)
                nrm = np.array([-d[1], d[0]])
                if nrm @ (((p + q) / 2) - c) < 0:
                    nrm = -nrm
                best, axis = score, nrm
        if axis is None:
            axis = np.array([-1.0 if side == "photo_left" else 1.0, 0.0])
    ang = np.degrees(np.arctan2(axis[1], axis[0])) - 90
    big = max(m.shape) * 2
    M = cv2.getRotationMatrix2D(tuple(map(float, c)), ang, 1.0)
    M[0, 2] += big / 2 - c[0]; M[1, 2] += big / 2 - c[1]
    r_img = cv2.warpAffine(rgb, M, (big, big), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    r_m = cv2.warpAffine(sm.astype(np.uint8), M, (big, big), flags=cv2.INTER_NEAREST) > 0
    r_m = cv2.erode(r_m.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0  # drop edge halo
    ys = np.flatnonzero(r_m.any(1))
    y0, y1 = ys[0], ys[-1]
    lefts = np.array([np.flatnonzero(r_m[y])[0] for y in ys])
    rights = np.array([np.flatnonzero(r_m[y])[-1] for y in ys])
    # use the cuff half of the sleeve (no diagonal shoulder cut there) to measure the band
    k0 = int(len(ys) * (0.35 if lm["style"] == "long_hanging" else 0.5))
    cl = int(np.median(lefts[k0:-2])) + 1
    cr = int(np.median(rights[k0:-2])) - 1
    if cr - cl < 10:
        return None
    wfull = cr - cl
    widths = np.array([r_m[y, cl:cr + 1].sum() for y in ys])
    ystart = ys[np.argmax(widths > 0.5 * wfull)]
    y0 = max(y0, ystart)
    while y1 > y0 and r_m[y1, cl:cr + 1].mean() < 0.97:  # ragged cuff edge
        y1 -= 1
    band = r_img[y0:y1 + 1, cl:cr + 1]
    valid = r_m[y0:y1 + 1, cl:cr + 1]
    band = reflect_fill(band, valid, axis=1)  # diagonal shoulder cut -> mirrored fabric from below
    return band, y1 - y0 + 1


def make_shirt(path, back_path=None, shading=1.0):
    rgb = np.array(Image.open(path).convert("RGB"))
    m = get_mask(rgb)
    lm = landmarks(m)
    x0, x1, top = lm["x0"] + 2, lm["x1"] - 2, lm["top"]  # step inside the cutout edge
    W = x1 - x0
    s = 128.0 / W  # the ONE uniform scale for every torso face
    me = cv2.erode(m.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0  # edge pixels get replaced

    def first_row(x):
        c = np.flatnonzero(m[:, x]); return c[0] if len(c) else top
    yT = int(np.mean([first_row(x0 + int(0.12 * W)), first_row(x1 - int(0.12 * W))]))
    lm["front_top"] = yT
    cx = (x0 + x1) // 2

    body = np.zeros_like(m); body[:, x0:x1] = True; body &= m
    gmask = graphic_mask(rgb, body)
    clean = clone_fill(rgb, gmask, me & body)

    front_src = reflect_fill(rgb, me, axis=1)   # fabric continues above shoulders (mirrored, real pixels)
    clean_src = reflect_fill(clean, me, axis=1)
    # back / up: no neckline -> replace the collar area with fabric mirrored from just below it
    neck = np.zeros_like(m)
    cv2.ellipse(neck.view(np.uint8), (cx, yT), (int(0.24 * W), int(0.16 * W)), 0, 0, 360, 1, -1)
    noneck = reflect_fill(clean_src, ~neck, axis=1)

    faces = {}
    faces[("torso", "front")] = crop(front_src, x0, yT, W, W)
    half = W / 2
    faces[("torso", "right")] = crop(clean_src, x0, yT, half, W)[:, ::-1]   # touches front's left edge
    faces[("torso", "left")] = crop(clean_src, x1 - half, yT, half, W)[:, ::-1]  # touches front's right edge
    if back_path:
        brgb = np.array(Image.open(back_path).convert("RGB"))
        bm = get_mask(brgb); blm = landmarks(bm)
        bW = blm["x1"] - blm["x0"] - 4
        bsrc = reflect_fill(brgb, cv2.erode(bm.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0, axis=1)
        faces[("torso", "back")] = crop(bsrc, blm["x0"] + 2, blm["top"], bW, bW)
    else:
        faces[("torso", "back")] = crop(noneck, x0, yT, W, W)[:, ::-1]
    faces[("torso", "down")] = crop(clean_src, x0, yT + W, W, half)
    up = crop(noneck, x0, yT, W, half)[::-1].astype(np.float32)
    # neck hole in the middle of the top face (soft dark ellipse, like the reference technique)
    hole = np.zeros(up.shape[:2], np.float32)
    hh, ww = up.shape[:2]
    cv2.ellipse(hole, (ww // 2, int(hh * 0.55)), (int(ww * 0.14), int(hh * 0.24)), 0, 0, 360, 1, -1)
    hole = cv2.GaussianBlur(hole, (0, 0), max(1.0, ww * 0.012))
    rim = cv2.GaussianBlur(hole, (0, 0), max(1.5, ww * 0.03)) - hole * 0.6
    up_rgb = (up * (1 - 0.35 * np.clip(rim, 0, 1)[..., None])).astype(np.uint8)
    up_alpha = (255 * (1 - np.clip(hole * 1.3, 0, 1))).astype(np.uint8)
    faces[("torso", "up")] = (up_rgb, up_alpha)

    # sleeves -> arms (photo's left sleeve = character's RIGHT arm). Uniform scale per sleeve: band width -> 64px.
    info = {}
    bands = {arm: sleeve_band(rgb, m, side, lm) for side, arm in (("photo_left", "rarm"), ("photo_right", "larm"))}
    def sleeve_ok(r):
        if r is None: return False
        b, L = r
        sa_ = max(s, 64.0 / b.shape[1])
        return sa_ <= 2.0 * s and b.shape[0] * sa_ >= 0.8 * 44
    both_ok = all(sleeve_ok(r) for r in bands.values())
    Ls = [r[1] for r in bands.values() if r is not None]
    for side, arm in (("photo_left", "rarm"), ("photo_right", "larm")):
        res = bands[arm]
        if res is None:
            res = (crop(clean_src, x0, yT, 64 / s, 128 / s), 0)
        band, L = res
        bw = band.shape[1]
        sa = max(s, 64.0 / bw)  # same scale as the torso when the sleeve is wide enough
        if band.shape[1] * sa > 64.5:
            cw = int(round(64 / sa)); c0 = (band.shape[1] - cw) // 2
            band = band[:, c0:c0 + cw]
        long_sleeve = lm["style"] == "long_hanging" or L * s > 100
        need = int(round(128 / sa))
        if long_sleeve:
            seg = band[-need:] if band.shape[0] >= need else band  # keep the cuff at the bottom of the arm
            if seg.shape[0] < need:
                pad = need - seg.shape[0]
                seg = np.vstack([seg[:pad][::-1], seg])
            fill = 128
            source = "sleeve"
        else:
            fill = int(np.clip(round(max(Ls + [0]) * s * 1.15), 52, 64))
            if both_ok:
                seg = band; source = "sleeve"
                if seg.shape[0] < need:
                    pad = need - seg.shape[0]
                    seg = np.vstack([seg, np.tile(seg[::-1], (pad // seg.shape[0] + 2, 1, 1))[:pad]])
                seg = seg[:need]
            else:
                # sleeve too small to sample cleanly: use real side-body fabric at the torso scale
                sa = s; source = "body_fabric"
                aw, ah = 64 / s, 128 / s
                sx = x0 if arm == "rarm" else x1 - aw
                seg = crop(clean_src, sx, yT + 0.25 * W, aw, ah)
                if arm == "larm":
                    seg = seg[:, ::-1]
        sq = int(round(64 / sa))
        face = to_face(seg, 64, 128)
        if not long_sleeve:  # soft hem shadow at the sleeve end
            f32 = face.astype(np.float32)
            for i, k in enumerate((0.78, 0.86, 0.93)):
                r = fill - 1 - i
                if 0 <= r < 128: f32[r] *= k
            face = f32.astype(np.uint8)
        alpha = np.zeros((128, 64), np.uint8); alpha[:fill] = 255
        for k, v in {"front": face, "back": face[:, ::-1], "left": face[:, ::-1], "right": face}.items():
            faces[(arm, k)] = (v, alpha)
        topsrc = seg if source == "body_fabric" else band
        topsq = topsrc[:sq] if topsrc.shape[0] >= sq else np.vstack([topsrc, topsrc[::-1]])[:sq]
        if topsq.shape[1] * sa > 64.5:
            topsq = topsq[:, :int(round(64 / sa))]
        faces[(arm, "up")] = to_face(topsq, 64, 64)
        if long_sleeve:
            faces[(arm, "down")] = to_face(band[-sq:], 64, 64)
        info[arm] = dict(sleeve_len_px=int(L), band_w_px=int(bw), arm_fill_px=int(fill), long=bool(long_sleeve), source=source)

    tpl = np.zeros((H_T, W_T, 4), np.uint8)
    for key, (x, y, w, h) in LAYOUT.items():
        if key not in faces:
            continue
        f = faces[key]
        alpha = None
        if isinstance(f, tuple):
            f, alpha = f
        if f.shape[:2] != (h, w):
            f = to_face(f, w, h)
            if alpha is not None and alpha.shape[:2] != (h, w):
                alpha = cv2.resize(alpha, (w, h), interpolation=cv2.INTER_AREA)
        tpl[y:y + h, x:x + w, :3] = f
        tpl[y:y + h, x:x + w, 3] = 255 if alpha is None else alpha
    tpl = apply_shading(tpl, shading)
    lm.update(scale=s, body_width_px=int(W), arms=info)
    return tpl, dict(lm=lm, mask=m, graphic=gmask, neck=neck)


def checker(h, w, a=(17, 17, 17), b=(26, 26, 26), sz=8):
    yy, xx = np.mgrid[0:h, 0:w]
    c = ((yy // sz + xx // sz) % 2)[..., None]
    return np.where(c, np.array(b, np.uint8), np.array(a, np.uint8)).astype(np.uint8)


def over(rgba, bg):
    a = rgba[..., 3:4].astype(np.float32) / 255
    return (rgba[..., :3] * a + bg * (1 - a)).astype(np.uint8)


def mockup(tpl):
    """Flat 2D R6 front/back mockup (no 3D)."""
    def face(k):
        x, y, w, h = LAYOUT[k]; return tpl[y:y + h, x:x + w]
    def body(view):
        canvas = np.zeros((128 + 140, 256, 4), np.uint8)
        head = np.zeros((60, 64, 4), np.uint8); head[...] = (163, 162, 165, 255)
        canvas[8:68, 96:160] = head
        if view == "front":
            parts = [(("rarm", "front"), 0), (("torso", "front"), 64), (("larm", "front"), 192)]
        else:
            parts = [(("larm", "back"), 0), (("torso", "back"), 64), (("rarm", "back"), 192)]
        y0 = 70
        skin = np.zeros((128, 64, 4), np.uint8); skin[...] = (163, 162, 165, 255)
        for k, x in parts:
            f = face(k)
            w = f.shape[1]
            region = canvas[y0:y0 + 128, x:x + w]
            if k[0] != "torso":
                region[...] = skin
            a = f[..., 3:4].astype(np.float32) / 255
            region[..., :3] = (f[..., :3] * a + region[..., :3] * (1 - a)).astype(np.uint8)
            region[..., 3] = 255
        return canvas
    return np.hstack([body("front"), np.zeros((268, 24, 4), np.uint8), body("back")])


if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    back = sys.argv[sys.argv.index("--back") + 1] if "--back" in sys.argv else None
    os.makedirs(out, exist_ok=True)
    name = os.path.splitext(os.path.basename(src))[0]
    tpl, dbg = make_shirt(src, back)
    Image.fromarray(tpl, "RGBA").save(f"{out}/{name}_template.png")
    Image.fromarray(mockup(tpl), "RGBA").save(f"{out}/{name}_mockup.png")
    json.dump(dbg["lm"], open(f"{out}/{name}_landmarks.json", "w"), indent=1, default=int)
    print(name, dbg["lm"])
