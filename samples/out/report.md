# Auto Bash integration review

All four input photos in `samples/` were rerun through the app's normal Auto Bash route at the default shading strength. Both tops used the supplied `autobash_core` engine. Both pants used the existing renderer. The supplied engine files match the originals on `main`.

| Sample | Placement | Proportions | Edges | Seams | Fabric | Shading | Details | Color | Back and sides |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Black shirt, flat-lay | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 |
| Blue jeans, flat-lay | 4 | 4 | 4 | 3 | 3 | 3 | 4 | 4 | 2 |
| Black pants, worn | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 1 |
| White shirt, worn | 2 | 3 | 2 | 2 | 2 | 3 | 2 | 3 | 2 |

- The flat-lay black shirt keeps its front lettering and has a clean cloned back, an open neckline, and shaded short-sleeve bands. The engine uses body fabric for the sleeves when the photographed sleeve patches are too small.
- The worn white shirt shows the front print. The supplied model also picks up skin and background, and some of those pixels carry over to the sleeves, sides, and back.
- The blue jeans retain their complete leg wraps. The black pants photo still shows some skin and jacket material. Both samples use the existing pants code, and their torso backs are transparent without back photos.

Each 2× checkerboard preview links to the original transparent 585 × 559 template. The broader 30-photo review remains open.

[![Black shirt, flat-lay](review/black-shirt-test.jpg)](black-shirt-test.png)

[![Blue jeans, flat-lay](review/blue-pants-test.jpg)](blue-pants-test.png)

[![Black pants, worn](review/black-pants-on-body.jpg)](black-pants-on-body.png)

[![White shirt, worn](review/white-shirt-on-body-test.jpg)](white-shirt-on-body-test.png)
