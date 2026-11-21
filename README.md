# ThreadPort

ThreadPort is being built to turn clothing photos into Roblox Classic Clothing. Auto Bash now removes the background, finds clothing parts, and places the photographed fabric on a Roblox template.

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

## What works now

- In **Auto Bash**, browse, drop, or paste a main photo. You can also add one back photo and up to three angles. The uploader accepts JPG, PNG, and WebP images up to 10 MB and 20 megapixels each.
- Choose **Auto** for a template suggestion or select **Shirt**, **Pants**, or **T-Shirt** yourself. The processing checklist updates while the server removes the background, cuts out the parts, and places them.
- The **Result** screen shows the template next to your photo. Use **Photo preview** to inspect the cutouts and **Show regions** to check where the parts landed. Classic templates use a 585 × 559 canvas. T-shirt graphics use a 512 × 512 canvas.
- Classic Shirts use the supplied [Auto Bash core](autobash_core/README.md). It uses a back photo when supplied and clones real front fabric for the back otherwise. To adjust the preview, change **Quick-Fix → Shading strength** and let the server render the same photos again. Pants and 512 × 512 T-Shirt graphics use the existing renderer. Extra angles are available for cutout preview.
- In **Studio**, preview or download a blank template. Shirts and pants export at 585 × 559 pixels. T-shirts export at 512 × 512 pixels. **Show regions** adds guides to the preview, and left and right refer to the avatar's sides.

For the cleanest placement, photograph one whole garment straight-on against a plain background and spread the sleeves or legs so their edges are visible. Worn photos can include other clothing or skin in the cutouts. The supplied shirt engine is designed for plain-background top photos. Its default model may pick up skin or background on worn photos.

The classic rectangles match the coordinates in `AGENTS.md` and the face sizes in the Roblox Creator Hub guide. All 18 rectangles also match the supplied official shirt and pants JPEGs after registration. These files are enlarged and cropped, so the test checks the relative bounds and face order alongside the exact 585 × 559 layout test. [Roblox Classic Clothing guide](https://create.roblox.com/docs/avatar/classic-clothing)

### Clothing models

The first Classic Shirt request downloads and verifies the core engine's ISNet weights (about 179 MB) in the writable model cache. Later requests use the cached weights. The app uses its existing GrabCut path to classify uploads and show cutout previews by default. Set `THREADPORT_REMBG=1` when starting the API if you also want the separate rembg clothing model for that preliminary step.

### Processing API

`POST /process` accepts multipart form data with a required `front` file, an optional `back` file, up to three repeated `angles` files, and a `mode` value of `auto`, `shirt`, `pants`, or `t-shirt`. For Classic Shirts, `shading` takes a value from 0 to 1 and defaults to 1. The response is newline-delimited JSON. It streams `progress` events, a `photo` event with a base64 PNG and classification data for each input, and a final `result` containing the base64 template PNG, template mode, placement profile, and whether the back photo was used. Photo errors that occur after streaming begins arrive as an `error` event.

## Run the tests

Install the frontend and backend dependencies from the setup above, then run these commands from the repository root.

```sh
npx playwright install chromium
.venv/bin/python -m unittest backend.test_photos backend.test_placement backend.test_template_references backend.test_shirt_engine
U2NET_HOME="$PWD/.threadport-models" npm test
npm run build
```

With Chromium already installed, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its path when running `npm test`. Playwright starts its own frontend on port 4173 and API on port 8001. The backend tests check cutouts and classifications using the repository sample photos. Browser tests cover uploads, cancellation, the generated Result preview, and the Studio template tools.

Rebuild the review PNGs through the same placement pipeline as Auto Bash.

```sh
U2NET_HOME="$PWD/.threadport-models" OMP_NUM_THREADS=2 .venv/bin/python -m backend.run_samples --review
```

The review command saves the original template PNGs and enlarged checkerboard copies. See both in the [visual review](samples/out/report.md).

## Next

The supplied core includes shading for shirts. Broader seam, material, and detail cleanup remains Stage 4 work.
