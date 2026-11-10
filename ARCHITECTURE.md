# Architecture

ATELIER extends OpenPlan3D (SvelteKit 2, Svelte 5, TypeScript, three.js 0.182) rather than replacing it. See `RESEARCH.md` for why.

## One project model

`src/lib/models/types.ts` defines the project: floors holding walls, doors, windows, rooms, furniture, stairs, columns, annotations and cabinets. Lengths are centimetres. A plan point `(x, y)` maps to three.js `(x, height, y)`.

`src/lib/stores/project.ts` owns the current project. Edits go through `mutate(fn, description, coalesceKey)`, which provides undo and redo. 2D, 3D and Render read this one store, so there is no separate 3D model to keep in sync.

## Workspaces

| Mode | Main code | Behaviour |
|---|---|---|
| 2D | `components/editor/FloorPlanCanvas.svelte` | Canvas drafting, snapping, typed lengths |
| 3D | `components/viewer3d/ThreeViewer.svelte` | Rebuilds geometry when `sceneSignature` changes; orbit, walkthrough, standard views through `utils/frameScene.ts` |
| Render | `utils/progressiveRender.ts`, `renderSettings.ts`, `renderEnvironment.ts` | three-gpu-pathtracer progressive samples over the same three.js scene |

## ATELIER additions

Floor plan import: `services/floorPlanFile.ts` turns a PDF page or image into a canvas, `utils/floorPlanDetect.ts` finds axis-aligned walls and reads gaps as doors and windows in image pixels, `components/FloorPlanImportModal.svelte` handles scale and review, and `importFloorPlan` in `stores/project.ts` applies the draft as one undo step. Nothing leaves the browser.

- `utils/cabinetModel3d.ts`, `components/sidebar/BuildPanel.svelte` and `PropertiesPanel.svelte`: parametric cabinets.
- `utils/cabinetFinishes.ts`: 13 PBR finishes (colour, roughness, metalness, transmission).
- `utils/modelExport.ts`: GLB and OBJ export in metres, excluding viewer helpers.
- `utils/houseTemplates.ts`: illustrative 4-room HDB flat template.
- `utils/solids.ts`, `utils/solidModel3d.ts`, `utils/modelingTools.ts`: extruded `Floor.solids`, push/pull rules for solids, walls and cabinets, and the Edit Mode face-drawing tools.
- `utils/walkCollision.ts`: obstacle list from the project floor and circle push-out, applied by `utils/walkthroughMotion.ts` on every motion substep.
- `utils/panorama.ts`: cube faces to equirectangular projection and photo sphere XMP; the faces come from the live renderer in `ThreeViewer.svelte`.

## Rendering modes

Interactive mode is WebGL rasterisation with shadows and ACES tone mapping. Render mode is genuine progressive path tracing through three-gpu-pathtracer. The two are different techniques and the app does not present one as the other. Quality presets in `renderSettings.ts` set bounces, target samples, tiles and render scale, from Performance (2 bounces, 32 samples, 0.5 scale) to Photorealistic (10 bounces, 2000 samples, full scale).

## Tests

`tests/*.test.ts` run under Vitest. `tests/browser/*.spec.ts` run under Playwright against the production build. `tests/browser/full-workflow.spec.ts` is the end-to-end room design workflow.
