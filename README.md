# ThreadPort

ThreadPort is being built to turn clothing photos into Roblox Classic Clothing. Stage 1 gives you a blank template to preview and download.

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
.venv/bin/python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

`GET /health` checks whether the API is running. `GET /template-layout` returns the same classic shirt and pants layout that the preview reads from `shared/templateLayout.json`.

## What works now

- Switch between Auto Bash and Studio. Studio has an editable name for the current session. My Projects shows a placeholder.
- Pick Shirt, Pants, or T-Shirt. Turn on **Show regions** to see the template faces. Right and left refer to the Roblox avatar's sides.
- Select **Download PNG** to save a transparent sRGB image. Shirts and pants export at 585 × 559 pixels. T-shirts export at 512 × 512 pixels. Region guides appear only in the preview.

The rectangles match the coordinates in `AGENTS.md` and the face sizes in the Roblox Creator Hub guide. Direct comparison with Roblox's downloadable artwork is pending because the cloud environment could not retrieve the template archive. [Roblox Classic Clothing guide](https://create.roblox.com/docs/avatar/classic-clothing)

## Run the tests

```sh
npx playwright install chromium
npm test
npm run build
```

With Chromium already installed, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its path and run `npm test`. The tests start their own frontend server and check the 18 exact rectangles, right/left placement, PNG downloads, and the shell on desktop and a narrow phone.

## Next

Stage 2 adds photo upload, background removal, and live processing progress.
