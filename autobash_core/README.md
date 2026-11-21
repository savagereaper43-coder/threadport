# Auto Bash core (working, tested engine)

One photo of a top on a plain background -> finished 585x559 Roblox Classic Shirt template.
The app's backend should call `make_shirt(path, back_path=None, shading=1.0)` and keep these rules exactly.

Install: pip install rembg onnxruntime opencv-contrib-python pillow numpy
Run:     python autobash.py photo.jpg out_dir [--back back_photo.jpg]
Review:  python review.py photo1.jpg photo2.jpg   (side-by-side sheets in out/)

Photobash rules: ONE uniform scale + rotation only, real photo pixels, clone-stamp fill. Never stretch, never smear.

Pipeline:
1. Cutout: rembg isnet-general-use + plain-background refinement (removes floor visible between hanging sleeves).
2. Landmarks from silhouette: body edges, shoulder top, armpit, hem; style = sleeves_out or long_hanging.
3. Scale s = 128 / body width. Torso Front = square crop from shoulder top.
4. Print removal ("clean" fabric for back/sides/arms): strong + thin-line + faint-nearby detection, then
   clone-stamp tiles copied from nearby clean fabric with soft edges (no Poisson: it leaks letters back in).
5. Sides = clean fabric beside each body edge, mirrored so the seam column touches Torso Front.
6. Back = clean front mirrored, neckline filled (or --back photo). Down = fabric below front.
   Up = mirrored top band with a transparent soft neck hole + darker collar rim.
7. Arms: sleeve rotated upright from the cuff edge; inner fabric band at uniform scale, cuff kept.
   Short sleeves fill top ~40-50% + hem shadow. Tiny sleeves -> real side-body fabric for BOTH arms.
8. Shading: per-face pro-style folds (armpit folds, side roll-off, hem, sleeve seams) as multiply shadows
   and gentle screen highlights, adapted to fabric brightness. `shading` = strength slider (0 = off).

Next: pants (same approach: waist at one scale, each leg rotated upright filling all 4 leg faces).
