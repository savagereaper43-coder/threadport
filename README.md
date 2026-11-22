# ThreadPort

ThreadPort turns clothing photos into Roblox Classic Clothing. Auto Bash removes the background and places photographed fabric on a template. Use Studio to edit layers and export a transparent PNG.

## Run locally

Use Node.js 20.19+ on the 20.x line or 22.12+, and Python 3.11+.

From the repository root, install and start the frontend.

```sh
npm install
npm run dev
```

Open http://localhost:5173. If npm cannot write to its default cache in the cloud workspace, run `npm install --cache /tmp/threadport-npm-cache`.

In a second terminal at the repository root, create the Python environment and start the API.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
U2NET_HOME="$PWD/.threadport-models" OMP_NUM_THREADS=2 \
  .venv/bin/python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

The Vite development server forwards `/api` to port 8000. To use a different backend address, set `THREADPORT_API_URL` when starting Vite. `GET /health` checks the API, and `GET /template-layout` returns the shared classic-clothing region rectangles.


## Run with Docker Compose

With Docker and the Compose plugin installed, run this from the repository root.

```sh
docker compose up --build
```

Open http://localhost:8080. Compose runs a production frontend and serves the API under the same address. Set `THREADPORT_PORT` to change the local port. Use `docker compose down` to stop the services. The named model cache survives restarts.

Classic Shirts use the supplied model by default. Allow the first run to download the ISNet weights, or use `THREADPORT_CORE_MODEL=0 docker compose up --build` to use the local, model-free cutout and placement path. In a network with a private CA, Compose can pass a build secret named `registry_ca` to both services. Use a PEM bundle containing the trusted CA certificates.

## What works now

- In **Auto Bash**, browse, drop, or paste a main photo. You can also add one back photo and up to three angles. The uploader accepts JPG, PNG, and WebP images up to 10 MB and 20 megapixels each.
- Choose **Auto** for a template suggestion or select **Shirt**, **Pants**, or **T-Shirt** yourself. The processing checklist updates while the server removes the background, cuts out the parts, and places them.
- The **Result** screen shows the template next to your photo, with a flat front and back avatar preview beneath it. Use **Photo preview** to inspect the cutouts and **Show regions** to check where the parts landed. Classic templates use a 585 × 559 canvas. T-shirt graphics use a 512 × 512 canvas.
- Classic Shirts use the supplied Auto Bash core. Clear cuffs guide long-sleeve placement, and detected tanks leave the arm faces transparent. Fitted skirts with a short center slit use a Classic Pants template with the photographed front spanning both upper legs. When there's no pants back photo, the app builds a back from real leg fabric and offers another version. Extra angles are available for cutout preview. [Auto Bash core](autobash_core/README.md)
- **Quick-Fix** updates the template and avatar preview together. Adjust sharpness, brightness and saturation, swap a fabric color, remove a prominent logo, or choose a style. For a classic template, adjust the placement engine's shading or rebuild the back with sampled fabric. For a Classic Shirt, you can also change sleeve length. **Reset adjustments** restores the default settings. **Re-run auto placement** processes the original uploads again.
- The **Catalog checklist** checks the current image for size, PNG format, transparency, and empty required regions. It reminds you to check logo permissions and has copy buttons for a suggested name, description, and tags. **Download PNG** saves the current result at its original template size with transparency and an sRGB profile.
- **Home** opens Auto Bash or Studio and shows the six most recent projects. **My Projects** lets you search, organize projects into folders, duplicate them, or delete them. Studio autosaves projects in IndexedDB in the current browser.
- **Studio** starts with a blank template or imports an existing template PNG. Use the tool rail to select, paint, transform, add text and shapes, or retouch fabric. Layers support ordering, grouping, masks, opacity, blend modes, and color and tone adjustments. Use **Undo**, **Redo**, or a named snapshot to return to earlier artwork.
- In **Edit in Studio**, each populated face of the current Auto Bash result opens as a separate layer. The original photos and their cutouts are available in the tray. The Auto Bash core produces a rendered template, so its internal clone strokes open as part of their respective face.
- In Studio's **Photo tray**, add photos to remove their backgrounds. Click the cutout or use Lasso to select a piece. Drag a piece to a face to fit it, or select a region and use the **Regions** panel to place or wrap it. **Assets** provides fabric, garment details, a pattern tiler, and shading. Region guides and seam previews help line up adjacent faces.
- Use **Avatar preview** to check the front and back. **Download PNG** exports only the artwork at 585 × 559 for shirts and pants or 512 × 512 for T-shirt graphics. Guides stay on screen. The **Catalog checklist** uses the same image checks as Auto Bash.
- **Batch mode** queues one photo per garment. Set the garment type for each item, pause or retry processing, then open any ready result. Edits saved with **Back to batch** carry into its individual PNG and the batch ZIP. The queue stays in the current Auto Bash session.
- Use **Restyle an existing Roblox template** to open a 585 × 559 Classic PNG or a 512 × 512 square graphic. Choose a style in Quick-Fix. **Build from a starter base** works directly from a garment photo or fabric close-up, even if automatic placement is unsuitable.
- On the Result screen, **Make matching pants** or **Make matching shirt** samples the current fabric away from flagged artwork to style a complementary garment. **Colorways** previews six choices and lets you add a custom color. **Starter bases** applies sampled fabric to a hoodie, jersey, jeans, or joggers.
- **Export set (ZIP)** includes the current PNG and the matching item, starter, and colorways prepared in that Result session. **Before/after image** saves a comparison of the source and the current template.
- The **Logo and text check** highlights possible high-contrast artwork on the front or back. You can remove it or replace it with an original PNG. The check uses image contrast and does not identify brands or read text. The **Help center** includes photo examples and export tips.

For the cleanest placement, photograph one whole garment straight-on against a plain background and spread the sleeves or legs so their edges are visible. Auto Bash gives tight crops and worn shirts a neutral matte when needed. It checks large product cutouts against the model output and uses the local placement path if the model misses most of the garment. Worn photos can still lose detail behind folds or arms.

The finishing pass uses patterned fabric where a strong repeat can be detected, matches colors across adjacent faces, and sharpens photographed details gently. Result shows an **Estimated match** and **Show regions** marks uncertain areas in amber. The estimate uses fabric coverage, seam alignment, color, and whether fabric was inferred. Focus a region with Tab or point to it to read its score.

The classic rectangles match the coordinates in `AGENTS.md` and the face sizes in the Roblox Creator Hub guide. All 18 rectangles also match the supplied official shirt and pants JPEGs after registration. These files are enlarged and cropped, so the test checks the relative bounds and face order alongside the exact 585 × 559 layout test. [Roblox Classic Clothing guide](https://create.roblox.com/docs/avatar/classic-clothing)

### Studio shortcuts

| Action | Shortcut |
|---|---|
| Move, rectangle select, lasso, magic wand | V, M, L, W |
| Brush, eraser, clone stamp, fill, eyedropper | B, E, S, G, I |
| Text, shapes, hand, zoom | T, U, H, Z |
| Change brush size | [ / ] |
| Pan and zoom | Space + drag, scroll |
| Undo, redo, duplicate layer | Ctrl/Cmd + Z, Ctrl/Cmd + Shift + Z, Ctrl/Cmd + J |

Alt-click the canvas with Clone Stamp to sample fabric, then brush where you want the copy. For a layer mask, use Eraser to hide and Brush to reveal. With the canvas focused, use the arrow keys to move the cursor and Enter to use the selected tool. Hold Shift to move farther. Use Shift + Enter to start a brush stroke, then Enter to finish.

### Clothing models

The first Classic Shirt request downloads and verifies the core engine's ISNet weights (about 179 MB) in the writable model cache. Later requests use the cached weights. The app uses GrabCut to classify uploads and show cutout previews by default. It can retry a difficult cutout with ISNet and can render a shirt with local placement if the model fails. Set `THREADPORT_CORE_MODEL=0` to use local placement directly. Set `THREADPORT_REMBG=1` when starting the API if you also want the separate rembg clothing model for that preliminary step.

### Processing API

`POST /process` accepts multipart form data with a required `front` file, an optional `back` file, up to three repeated `angles` files, and a `mode` value of `auto`, `shirt`, `pants`, or `t-shirt`. For classic shirts and pants, `shading` takes a value from 0 to 1 and defaults to 1. The response is newline-delimited JSON. It streams `progress` events, a `photo` event with a base64 PNG and classification data for each input, and a final `result` containing the base64 template PNG, template mode, placement profile, whether the back photo was used, and the estimated match and regions. New pants backs can include an alternate template. Photo errors that occur after streaming begins arrive as an `error` event.

`POST /cutout` accepts a single multipart `front` photo and returns its transparent PNG and classification. Studio uses it to cut photos without running template placement.

`POST /check-graphics` accepts JSON with the base64 template `png` and its `mode`. It returns candidate rectangles with template coordinates and the front or back face.

`POST /quick-fix` accepts JSON with the original base64 template `png`, its `mode`, and a `fixes` object. It returns the adjusted base64 `png`. The Result screen sends its full set of edits each time so that repeated adjustments do not accumulate compression or color changes.

## Run the tests

Install the frontend and backend dependencies from the setup above, then run these commands from the repository root.

```sh
npx playwright install chromium
.venv/bin/python -m unittest backend.test_photos backend.test_placement backend.test_template_references backend.test_shirt_engine backend.test_quality backend.test_quick_fix
U2NET_HOME="$PWD/.threadport-models" npm test
npm run build
```

With Chromium already installed, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its path when running `npm test`. Playwright starts its own frontend on port 4173 and API on port 8001. The backend tests cover cutouts, placement, and Quick-Fix edits. Browser tests cover uploads, cancellation, both avatar views, Quick-Fix, catalog copy buttons, PNG downloads, Studio painting and masks, IndexedDB reload, photo cutting and wrapping, the Auto Bash handoff, batch review, colorways, matching sets, and downloadable ZIPs.


## Sample review

The [golden review](samples/out/report.md) includes all 30 source photos, nine manual ratings for each rendered template, and links to the full-size PNGs. The [source and license list](samples/golden/SOURCES.md) covers the 26 Wikimedia Commons additions. Garment placement for a single flat-lay or product photo is the primary Auto Bash workflow. Folded garments, layered outfits, busy backgrounds, and photos with covered fabric can still need manual placement in Studio.

Run the same pipeline used by the web app.

```sh
U2NET_HOME="$PWD/.threadport-models" OMP_NUM_THREADS=2 .venv/bin/python -m backend.run_samples \
  --output /tmp/threadport-review --review --summary /tmp/threadport-review/render-summary.json
```

The command saves native template PNGs, enlarged checkerboard copies, and optional render diagnostics. It returns a nonzero status if any input fails. The recorded visual grades are separate from the in-app confidence percentages.

## Stage 8 verification

The production build loads Auto Bash, Studio, and Help separately. Importing just the Konva core and image shape reduced Result’s JavaScript chunk from about 355 kB to 272 kB before compression. The keyboard flow and automated accessibility checks cover the primary screens and the colorways dialog.

The quality gate remains open. The report records sleeve classification, repeat alignment, rear-only photos, folded garments, and worn-photo selection cases that need more work before all 30 photos meet the 4/5 target.
