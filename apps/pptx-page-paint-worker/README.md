# Native PPTX preview worker

Private Node 22+ adapter for real PPTX uploads. The Go helper extracts the original
package and invokes this worker through bounded, length-prefixed JSON. No hosted
service is required. Enable the helper with `-pptx-preview-worker` pointing to
`dist/worker.js` and `-pptx-font-manifest` pointing to an absolute local JSON file:

```json
{"version":1,"faces":[{"family":"DejaVu Sans","weight":400,"style":"normal","path":"/absolute/DejaVuSans.ttf","sha256":"sha256:<64 lowercase hex characters>"}]}
```

The operator is responsible for supplying appropriately licensed fonts and exact
family/style mappings. Each file is digest-checked and measured by the pinned
HarfBuzz implementation. No aliases, platform-font discovery, or silent fallback
are used. Missing family/weight/style combinations refuse visibly. Limits are
32 faces, 16 MiB per font, 64 MiB total font bytes, and 16 MiB framed JSON.

The playground's native PPTX workbench asks for explicit upload consent and
verifies the response's package SHA-256, slide index, and slide count before
mounting bounded SVG paths. Source files are never rewritten by this path.
Measured mixed-run line boxes and anchors use `max-run-natural-v1`, not an
Office-equivalence claim. The existing approximate file preview stays available.
Image raster and arrowhead commands in this new vector view remain visibly
unavailable; unqualified source content is not silently promoted to native paint.

Run `node scripts/smoke-pptx-native-preview-browser.mjs` from the built workspace
for real-file upload, HarfBuzz glyph, anchor, consent, and missing-font checks.
