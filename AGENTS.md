# AGENTS.md — ThreadPort

Read this whole file before every task. It is the single source of truth for this project.

## Rules for every task
1. Do ONLY the stage the task asks for (see "Build Stages"). Do not start later stages.
2. Never add 3D rendering. No Three.js, no react-three-fiber, no 3D preview of any kind.
3. Follow the "UI Design Spec" exactly. Black UI only. No light mode.
4. Keep the app working at the end of every task: `npm install && npm run dev` (frontend) and the backend start command in the README must run without errors.
5. Write or update tests for what you built and run them before finishing.
6. Update README.md: how to run, what works now, what's next.
7. Update the "Progress" section at the bottom of this file: mark the stage done and note anything unfinished.
8. Use plain, friendly language in all user-facing text. The user is a beginner who has never made Roblox clothing.

---

## Purpose
ThreadPort is a web app for people who **don't know how to photobash or make Roblox clothing**. The user uploads a photo of real clothing (a product photo, flat-lay, or someone wearing it). The app **does the entire photobash automatically**:
- understands the garment;
- cuts it into parts;
- places every part on the correct region of the Roblox Classic Clothing template;
- fills the gaps and adds shading;
- exports a finished 585×559 PNG ready to upload to the Roblox catalog.

The app has **two separate modes**:

1. **Auto Bash (the main feature, front and center):** upload → wait a few seconds → done. The user should never need to know what "torso front" or "left arm back" means.
2. **Studio (do it yourself):** a full manual photobash editor with tools. It is for users who want to make clothing by hand, or to fine-tune an Auto Bash result. It is a separate screen with its own workflow, not a hidden toggle.

Auto Bash results can be opened in Studio with one click ("Edit in Studio"). Studio and Auto Bash share the same template layout, layers format and export code.

## Tech Stack
- **Frontend:** React + TypeScript + Vite, Tailwind CSS, shadcn/ui, Framer Motion, Zustand, lucide-react icons.
- **2D canvas:** Konva.js (react-konva) for the result view and the optional touch-up tools.
- **Backend:** Python FastAPI with OpenCV, NumPy, Pillow and scikit-image.
- **Segmentation:**
  - Segment Anything (SAM/SAM2) or a garment-parsing ONNX model, with `rembg` as a fallback.
  - Everything must still work with classical CV (GrabCut, contours, color clustering) if the models are missing.
- **Landmarks:**
  - Garment keypoints (DeepFashion2-style) for collar, shoulders, armpits, cuffs, hem, waistband, crotch, knees and ankles.
  - For photos of a person wearing the clothes, a human pose model (e.g. MediaPipe).
- **Optional AI provider** (pluggable, configured by env var, off by default): garment analysis, inpainting for unseen areas, upscaling.
- **Repo layout:** a monorepo with `/frontend`, `/backend`, and `/shared` (template layout, placement rules, types).
- **Running:** locally with `npm run dev` and `uvicorn`, plus a `docker-compose up` option.

## Roblox Template Specs (must be exact)
- **Canvas:** 585×559 PNG. Transparent where unused, sRGB, exported at exact size with no scaling.
- **Shirt regions:**
  - Torso: Front and Back 128×128, Left and Right 64×128, Up and Down 128×64.
  - Each arm: Front/Back/Left/Right 64×128, Up/Down 64×64.
- **Pants:** same layout. The torso area becomes waist/hips and the arm areas become legs.
- **T-Shirt mode:** a single 512×512 image for the torso front.
- **Region config:** store all regions in `/shared/templateLayout.json` as `{ part, face, x, y, w, h }`, used by both frontend and backend.
- **Starting coordinates** (verify against the official Roblox template; keep it as a hidden debug overlay):
  - Torso: Up (231,8), Right (165,74), Front (231,74), Left (361,74), Back (427,74), Down (231,204)
  - Right Arm/Leg: Up (217,289), Left (19,355), Back (85,355), Right (151,355), Front (217,355), Down (217,485)
  - Left Arm/Leg: Up (308,289), Front (308,355), Left (374,355), Back (440,355), Right (506,355), Down (308,485)
- **Left/right:** the character's right side appears on the viewer's left in a front photo. Left/right must never be swapped.

## Auto Bash Quality Bar (non-negotiable)
Auto Bash is the product. It must be **amazing**, not "works". The goal is that the result looks like a skilled, experienced Roblox clothing designer photobashed it by hand, and it should be good enough to sell on the catalog.

**What "amazing" means. Every output must have:**
1. **Correct placement:** every part on the right face, left/right never swapped, sleeves on arms, legs on legs, nothing upside down or mirrored by mistake.
2. **Correct proportions:** shoulders, hems, cuffs, pockets, logos and zippers at the same relative position and scale as the real garment.
3. **Clean edges:** no leftover background, no halos, no jagged cutouts, no gaps or stray transparent pixels inside fabric.
4. **Seamless wrapping:** stripes, color blocks, hems and patterns connect across front → side → back and around the arms and legs. There are no visible seams.
5. **Real fabric:** filled areas look like the same fabric (texture, grain, pattern), never smeared, blurry, flat-filled or obviously cloned.
6. **Pro shading:** clear but natural folds, creases and depth in the style top Roblox clothing creators use. Never muddy, never too dark, and it never covers up graphics.
7. **Crisp details:** zippers, drawstrings, stitching, pockets and graphics readable at 128px and in-game.
8. **True color:** matches the real garment, with no color cast from the photo's lighting.
9. **Believable back and sides:** generated areas look intentional and garment-appropriate (a hood on hoodie backs, back pockets on jeans), not copies of the front with logos.

**How to achieve it (required techniques):**
- **Garment-specific pipelines:** don't use one generic algorithm. Each garment type has its own tuned placement rules, shading pack, detail set and back-generation logic: t-shirt, long sleeve, hoodie, zip hoodie, jacket/puffer, jersey, button-up, tank, sweater, jeans, cargo, joggers, shorts, skirt.
- **Best-of-N generation:** for each photo, generate several candidates with different crops, warps, fill methods and shading strengths. Score them with the self-check, return the best, and keep the runners-up available as "Try another version".
- **Use the strongest tools available:**
  - Use the best segmentation model you can run (SAM2 or a garment-parsing model) over classical CV.
  - When AI is enabled, use inpainting for the back and unseen areas, and upscaling before downscaling to 128px faces.
  - Classical CV is only the fallback.
- **Downscale carefully:** do all processing at high resolution and downscale each face only at the very end, with high-quality resampling and sharpening tuned for small sizes.
- **Shading asset packs:** ship high-quality layered shading PNGs (shadows, highlights, folds, seam lines) per garment type, modeled on how professional Roblox clothing creators shade. Do not generate shading only procedurally.
- **Detail library:** pre-drawn, pixel-crisp zippers, drawstrings, aglets, buttons, stitching and pocket edges, recolored automatically to match the garment and placed using detected landmarks.

**The quality loop (required in Stages 3, 4 and 8):**
- Maintain a **golden sample set** in `/samples`: at least 30 real photos covering every garment type and photo type, including hard cases (patterns, graphics, dark fabric, white fabric, wrinkled, worn on a person).
- Score every output on the 9 criteria above (1–5 each) in `/samples/out/report.md`. **Actually look at the output images** and judge them visually; do not rely on numbers alone.
- Fix the lowest-scoring cases first. Do not mark a stage done while any sample scores below 3 on placement, edges or seams.
- Add a new regression sample every time a bug is fixed.

## Auto-Photobash Engine (most important)

### 1. Understand the photo
- Classify the photo type: flat-lay, hanger/product, ghost mannequin, worn by a person, or folded. Each type gets its own extraction strategy.
- Classify the garment and pick Shirt, Pants or T-Shirt mode automatically: t-shirt, long sleeve, hoodie, zip hoodie, jacket, puffer, vest, tank, jersey, button-up, sweater, crop top, dress, pants, jeans, cargo, joggers, shorts, skirt.
- Detect whether the photo shows the front or the back. If several photos are uploaded, sort them automatically.
- Remove the background with refined edges. Also remove hangers, mannequins, hands, skin/face/hair, and tags.

### 2. Find every garment part
- **Tops:**
  - body front and back, left and right sleeves;
  - collar/neckline, hood, cuffs, hem/waistband, shoulder seams, armpits;
  - pockets, zipper/placket/buttons, drawstrings, chest graphics/text.
- **Bottoms:**
  - waistband, belt loops, fly, front and back pockets, cargo pockets;
  - left and right legs, knees, ankle cuffs, side seams.
- **Worn photos:** map parts to body pose and remove arm/body occlusion where possible.

### 3. Unwarp each part
- Use a homography for flat panels and a thin-plate-spline/mesh warp for sleeves and legs.
- Straighten sleeves and legs to vertical.
- Remove perspective, folds and heavy shadows while keeping the real fabric color and texture.

### 4. Place parts using `/shared/placement_rules.json`
Rules are data, defined per garment type, so new types need no code changes.

| Garment part | Template destination |
|---|---|
| Body front (shoulders → hem) | Torso Front, with shoulders at the top edge and the hem at the bottom edge |
| Body back | Torso Back |
| Body side strips | Torso Left / Right |
| Neckline / collar / hood base / shoulder tops | Torso Up |
| Hem | Torso Down |
| Right sleeve (character's right) | Right Arm Front/Back/Left/Right, wrapped |
| Left sleeve | Left Arm faces, wrapped |
| Shoulder caps | Arm Up |
| Cuffs | Bottom of the arm faces + Arm Down |
| Short sleeves | Top portion of the arm faces only; the rest transparent |
| Sleeveless / tank | Arm faces transparent; straps at the top of the torso |
| Hood (down) | Upper Torso Back + Torso Up |
| Pocket / chest graphic / zipper | Torso Front at the correct relative position and scale |
| Pants waistband + fly + front pockets | Torso Front; belt line wraps Left/Right/Back |
| Back pockets | Torso Back |
| Right / left pant leg | Right / Left Leg faces, wrapped, with knees and cuffs placed correctly |
| Shorts | Upper portion of the leg faces only |

- Wrap sleeves and legs so each of the four faces gets the correct side of the fabric. Extend the fabric intelligently when only one side is visible.
- Keep relative proportions: a logo's size relative to the torso in the photo equals its size relative to the Torso Front region.
- Align stripes, hem bands and color blocks around the body. Align the shirt hem with the pants waistband.

### 5. Fill what the photo doesn't show
- **Missing back:** build it from the front's fabric with front-only details removed (logos, zippers, pockets, buttons). Add back-specific details by garment type (hood, yoke, back pockets). Use AI inpainting if it is enabled.
- **Missing sides, arm insides, Up and Down faces:** patch-based texture synthesis from nearby fabric. Never flat fill unless the fabric is flat.
- **Repeating patterns** (stripes, plaid, camo, dots): detect the repeat and tile it seamlessly at the correct scale and angle.

### 6. Auto-photobash finishing
- **Shading overlays:**
  - Ship them as hand-made PNG assets per garment type in `/frontend/public/shading/`.
  - Shade the folds under the arms, chest and waist folds, elbow and knee creases, the crotch, and the face edges.
  - Use multiply/overlay blending, adapted to the fabric color.
- **Highlights** on the shoulders, chest and knees.
- **Detail redraw:** re-draw zippers, stitching, drawstrings, buttons and pocket outlines crisply so they read at 128px.
- **Cleanup:** sharpen for small faces, remove noise and JPEG artifacts, and keep graphics crisp.
- **Seams and color:** blend color and texture at every face edge, and keep the real garment color accurate (white balance, uneven-lighting removal).

### 7. Self-check
- Compare the output against the photo and produce a **confidence score per region**.
- Highlight low-confidence regions with plain notes, e.g. "We guessed the back because no back photo was added."
- When a photo is unusable (blurry, cut off, heavily folded), explain why in plain words and show tips for a better photo.

---

## UI Design Spec (follow exactly)

### Colors (Tailwind theme tokens)
| Token | Value | Use |
|---|---|---|
| `bg` | `#000000` | page background |
| `surface` | `#0A0A0A` | cards, panels |
| `surface-2` | `#111111` | inputs, hovered cards |
| `border` | `#1F1F1F` | all borders (1px) |
| `text` | `#FFFFFF` | primary text |
| `muted` | `#A1A1A1` | secondary text |
| `faint` | `#5C5C5C` | hints, disabled |
| `accent` | `#3B82F6` | primary buttons, focus rings, progress, active states (use sparingly) |
| `success` | `#22C55E` | high-confidence badges |
| `warn` | `#F59E0B` | low-confidence badges |
| `danger` | `#EF4444` | errors |

### Type and shape
- **Font:** Inter or Geist.
  - Headings: 600 weight, tight letter-spacing (-0.02em).
  - Sizes: page title 32px, section title 20px, body 15px, labels 13px.
- **Corners:** cards 16px radius, buttons and inputs 12px, small chips 999px.
- **Spacing:** generous; a 24px minimum gap between major sections.
- **Shadows:** none. Depth comes from borders and subtle glows only:
  - hover = border `#2A2A2A` + a faint accent glow (`0 0 0 1px rgba(59,130,246,0.25)`);
  - focus = 2px accent ring.
- **Motion:** Framer Motion. 150–250ms ease-out, fades and small (8px) slides. No bouncy effects. Respect `prefers-reduced-motion`.
- **Checkerboard:** transparent areas of templates show a dark checkerboard (`#111` / `#1A1A1A`) so transparency is visible on black.

### Layout
- **Top bar** (56px, border-bottom):
  - left: logo wordmark "ThreadPort";
  - center: step indicator (Upload · Processing · Result);
  - right: mode tabs **Auto Bash | Studio** (pill-style segmented control; the active tab uses a white fill with black text) and a "My Projects" button.
  - In Auto Bash, the center of the top bar shows the step indicator (Upload · Processing · Result). In Studio, it shows the project name, which can be edited inline.
- **Max content width** 1280px, centered. Studio uses the full width.

### Screen 0 — Home
- A hero title "Turn any clothes photo into Roblox clothing".
- Two large cards side by side:
  - **Auto Bash** (bigger, accent border, labeled "Recommended"):
    - "Upload a photo. We cut, place and shade everything for you.";
    - button "Start Auto Bash".
  - **Studio:**
    - "Photobash it yourself with pro tools, guides and snapping.";
    - button "Open Studio".
- Below the cards: a "Recent projects" row (the last 6 projects).
- Auto Bash must be visually dominant; it is the main feature.

### Screen 1 — Upload
- A large centered drop zone (dashed 1.5px `border`, 16px radius, min-height 360px):
  - icon on top;
  - title "Drop a photo of any clothing";
  - subtitle "Shirts, hoodies, jackets, pants, shorts — we do the rest";
  - "Browse files" button; paste-from-clipboard support.
- Below the drop zone, two smaller optional slots side by side: "Add back photo (optional)" and "Add more angles (optional)".
- A row of 3 photo tips with icons: "Lay it flat", "Good lighting", "Whole item in frame". Include a "See good vs bad photos" link that opens a modal with examples.
- A mode selector as chips: Auto (default) · Shirt · Pants · T-Shirt.
- A big accent button: "Make my Roblox clothing". It is disabled until a photo is added.

### Screen 2 — Processing
- The photo thumbnail on the left, with a subtle animated scan line moving over it.
- On the right, a vertical checklist that ticks off as each step completes:
  - "Finding the clothing…"
  - "Removing background…"
  - "Cutting out sleeves / legs…"
  - "Placing pieces on the template…"
  - "Filling the back and sides…"
  - "Adding shading…"
  - "Checking quality…"
- A thin accent progress bar with a percentage, plus a "Cancel" text button.

### Screen 3 — Result
- **Three columns on desktop:**
  - left: the original photo;
  - center: the finished template, large, on the checkerboard;
  - right: the Quick-Fix panel.
- **Under the template:**
  - a **flat 2D front/back mannequin mockup**: a simple flat R6 silhouette, front and back, with the template faces composited on. Flat 2D only, no 3D;
  - an overall quality score chip, e.g. "Match 92%".
- **"Show regions" toggle:** outlines each template region. Low-confidence regions are outlined in `warn` with a tooltip note.
- **Quick-Fix panel** (cards with sliders and toggles):
  - Shading strength
  - Sharpness
  - Brightness / Saturation
  - Swap color (palette swatches you can click to recolor)
  - Remove logo
  - Make back plain
  - Regenerate back
  - Sleeves: Auto / Short / Long / None
  - Style: Realistic / Clean / Cartoon / Vintage / Grunge
  - Re-run auto placement
- **Primary button:** "Download PNG" (accent, full width at the bottom of the panel).
- **Secondary buttons:**
  - **"Edit in Studio"**: opens this result in Studio with all layers and detected parts kept separate and editable;
  - "Make matching pants" / "Make matching shirt";
  - "Colorways";
  - "Export set (ZIP)";
  - "Before/after image".
- **Catalog checklist card:** a pre-upload validator with ✓/✗ for size, PNG, transparency and empty regions, plus a logo warning. It also gives suggested name/description/tags with copy buttons, and a note to check Roblox's current upload fees and Marketplace rules on the Creator Hub. Never hard-code fees.

### Studio (separate manual mode)
A full photobash editor. It should feel like a simple, black-themed Photopea/Photoshop made only for Roblox clothing.

**Starting a Studio project:**
- A blank Shirt, Pants or T-Shirt template.
- Import an existing Roblox template PNG.
- Open an Auto Bash result (all parts stay as separate layers).

**Layout:**
- **Left tool rail** (56px, icons with tooltips and shortcut hints):
  - Move/Transform (V), Select: rectangle, lasso, magic wand, AI "select object" (M/L/W)
  - Brush (B), Eraser (E), Clone Stamp (S), Smudge, Fill (G), Gradient, Eyedropper (I)
  - Text (T), Shapes (U)
  - Warp/Mesh Warp, Perspective, Crop
  - Hand (H), Zoom (Z)
- **Top options bar:** settings for the active tool (size, hardness, opacity, flow, blend mode, tolerance).
- **Center canvas:** the 585×559 template on the checkerboard, with zoom and pan, and a pixel grid at high zoom.
- **Right panel (tabs):**
  - **Layers:** opacity, blend modes, masks, lock, hide, groups, reorder.
  - **Regions:** a list of every template face. Click one to zoom to it and isolate it.
  - **Assets:** shading overlays, fabric textures, patterns, garment details (zippers, pockets, drawstrings, buttons, laces), fonts, stickers.
  - **Colors:** picker, palette and recent colors.
- **Bottom photo tray:** imported clothing photos as thumbnails.

**Key Studio features:**
- **Photo cutter:** drop a photo, auto-remove the background, then cut parts with one click (AI select) or lasso. Cut parts appear in a "Pieces" list.
- **Drag-to-region:** drag a piece onto any template face. It auto-scales, warps and snaps to that face, with live outlines while dragging.
- **Wrap tool:** drop a sleeve or leg piece and choose "wrap around arm/leg" to fill all four faces automatically.
- **Region guides:**
  - labeled overlays (Front, Back, Left Arm…) that can be toggled;
  - clip-to-region painting, so strokes never spill into other faces;
  - a seam preview showing how edges connect.
- **Mirror and symmetry:**
  - copy left arm → right arm, front → back (with a logo-removal option);
  - a live symmetry brush.
- **Shading:** a one-click shading overlay per garment type, plus strength and color controls.
- **Adjustments** (non-destructive): hue/saturation, brightness/contrast, curves, levels, color balance, recolor.
- **Pattern tiler:** fill a region or all regions with a seamless pattern from a photo sample.
- **Quick actions:** the same Quick-Fix controls as Auto Bash (Remove logo, Make back plain, Regenerate back) can be run on any layer or region.
- **Guided tips:** an optional step-by-step helper panel for beginners learning to photobash:
  1. Cut out your photo
  2. Drag the body to Front
  3. Wrap the sleeves
  4. Fill the back
  5. Add shading
  6. Export
- **History:** undo/redo (100+ steps) and named snapshots.
- **Live 2D flat mannequin mockup:** a small floating panel that can be toggled. Flat 2D only, no 3D.
- **Export:** the same validator and Download PNG as Auto Bash.

**Shortcuts:** V, M, L, W, B, E, S, G, I, T, U, H, Z, [ and ] for brush size, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+J duplicate layer, Space+drag to pan, scroll to zoom.

### My Projects
- A grid of project cards (thumbnail, name, date, garment type chip), with search, folders, and duplicate/delete.
- Autosave to IndexedDB.

### Accessibility and quality
- WCAG AA contrast, visible focus rings, ARIA labels on icon buttons, full keyboard navigation.
- Skeleton loaders instead of spinners where possible.
- Errors use plain words plus a suggested fix.

---

## Extra Features (later stages)
- **Batch mode** with a review queue.
- **Matching sets** (pants for a shirt, a shirt for pants).
- **Colorway grid.**
- **Style presets.**
- **Starter bases:** apply a weak photo's colors and patterns onto a built-in hoodie, jersey, jeans, etc.
- **Template import:** bring in an existing Roblox template to fix or restyle it.
- **Logo/text detection** with a takedown warning, plus one-click removal or replacement with an original graphic.
- **Export:** PNG, ZIP sets, and a before/after share image.
- **Help center** with visual photo tips.

## Testing
- **Unit tests:**
  - every region lands on exact pixel coordinates;
  - left/right is never swapped;
  - exports are exactly 585×559.
- **Visual regression samples:** `/samples` holds 20+ photos (flat-lays, hangers, worn photos, patterns, pants, shorts). `npm run samples` (or `python -m backend.run_samples`) runs the full pipeline and saves outputs to `/samples/out` for visual review.

---

## Build Stages
1. **Foundation:**
   - monorepo setup;
   - Tailwind theme tokens and the black UI shell (top bar with the Auto Bash | Studio tabs, empty screens);
   - `templateLayout.json` and exact 585×559 export;
   - the template debug overlay;
   - tests for regions and export.
2. **Upload + background removal:**
   - the Upload screen, fully styled;
   - the backend `/process` endpoint;
   - background removal (rembg/SAM, with a GrabCut fallback);
   - garment type and photo type classification;
   - the Processing screen wired to real progress events.
3. **Parts + placement:**
   - part segmentation and keypoints;
   - unwarping;
   - `placement_rules.json` for t-shirt, long sleeve, hoodie, pants and shorts;
   - the first real auto templates shown on the Result screen.
4. **Photobash quality:**
   - gap filling and texture synthesis;
   - pattern tiling;
   - shading overlay assets and blending;
   - detail redraw, seam blending, color correction;
   - self-check confidence scores and region highlights.
5. **Result screen + Quick-Fix:**
   - the full Result screen;
   - the 2D flat mannequin mockup;
   - all Quick-Fix controls working;
   - the catalog checklist;
   - Download PNG.
6. **Studio + projects:**
   - the full Studio mode (all tools, layers, photo cutter, drag-to-region, wrap tool, region guides, assets, shortcuts);
   - "Edit in Studio" from Auto Bash;
   - the Home screen;
   - My Projects with IndexedDB autosave.
   - If this is too big for one task, split it: 6a = Studio canvas, tools and layers; 6b = photo cutter, drag-to-region, wrap and assets; 6c = Home, projects and the Edit-in-Studio handoff.
7. **Extras:** batch mode, matching sets, colorways, style presets, starter bases, template import, logo detection/removal, ZIP and before/after export, help center.
8. **Polish:**
   - an Auto Bash quality pass: run the full golden sample set, score it, and keep fixing until every sample scores 4+ on all 9 quality criteria;
   - run all samples and fix the worst results;
   - performance;
   - accessibility pass;
   - docker-compose;
   - final README.

---

## Progress
(Codex: update this after every task.)
- [x] Stage 1 — Monorepo, black UI shell, shared template layout, hidden region guides, and exact-size PNG export. Browser tests and API smoke checks passed. Direct pixel comparison against the official Roblox artwork is pending because the template download was blocked.
- [ ] Stage 2
- [ ] Stage 3
- [ ] Stage 4
- [ ] Stage 5
- [ ] Stage 6
- [ ] Stage 7
- [ ] Stage 8
