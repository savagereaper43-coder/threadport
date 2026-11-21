"""Build a side-by-side review sheet: photo with detected points | template | 2D mockup."""
import sys, os
import numpy as np, cv2
from PIL import Image
import autobash as ab


def sheet(path, out):
    rgb = np.array(Image.open(path).convert("RGB"))
    tpl, d = ab.make_shirt(path)
    lm = d["lm"]
    vis = rgb.copy()
    tint = vis.copy(); tint[~d["mask"]] = (tint[~d["mask"]] * 0.35).astype(np.uint8); vis = tint
    vis[d["graphic"]] = (vis[d["graphic"]] * 0.5 + np.array([255, 60, 60]) * 0.5).astype(np.uint8)
    W = lm["x1"] - lm["x0"]
    cv2.rectangle(vis, (lm["x0"], lm["front_top"]), (lm["x1"], lm["front_top"] + W), (59, 130, 246), 2)
    for p in [(lm["x0"], lm["armpit"]), (lm["x1"], lm["armpit"]), (lm["cx"], lm["hem"])]:
        cv2.circle(vis, p, 5, (34, 197, 94), -1)
    H = 559
    v = cv2.resize(vis, (int(vis.shape[1] * H / vis.shape[0]), H))
    t = ab.over(tpl, ab.checker(559, 585))
    # region outlines
    t2 = t.copy()
    for (x, y, w, h) in ab.LAYOUT.values():
        cv2.rectangle(t2, (x, y), (x + w - 1, y + h - 1), (60, 60, 60), 1)
    mk = ab.mockup(tpl)
    mk = ab.over(mk, np.zeros(mk.shape[:2] + (3,), np.uint8))
    mk = cv2.resize(mk, (mk.shape[1] * 2 // 1, mk.shape[0] * 2 // 1), interpolation=cv2.INTER_NEAREST)
    mk = cv2.resize(mk, (int(mk.shape[1] * H / mk.shape[0]), H))
    gap = np.zeros((H, 20, 3), np.uint8)
    canvas = np.hstack([v, gap, t2, gap, mk])
    Image.fromarray(canvas).save(out)
    return lm


if __name__ == "__main__":
    os.makedirs("out", exist_ok=True)
    for p in sys.argv[1:]:
        n = os.path.splitext(os.path.basename(p))[0]
        print(n, sheet(p, f"out/review_{n}.png"))
