# ATELIER: Open-Source Foundation Research

Research date: 2026-11-08. Metadata came from the GitHub API. "Source inspected" means the repository
was shallow-cloned and its files read. "Metadata only" means the code was not reviewed.

## Repositories investigated

| Repository | Licence | Last push | Stars | Depth | Result |
|---|---|---|---|---|---|
| [laanlabs/openPlan3D](https://github.com/laanlabs/openPlan3D) | MIT | 2026-10-23 | 277 | Source inspected, tests and build run | **Selected foundation** |
| [pascalorg/editor](https://github.com/pascalorg/editor) | MIT | 2026-11-08 | not recorded | Source inspected | Rejected, see below |
| [charmlinn/blueprint3d-modern](https://github.com/charmlinn/blueprint3d-modern) | MIT | 2026-05-22 | 155 | README and layout | Too thin |
| [mehanix/arcada](https://github.com/mehanix/arcada) | Apache-2.0 | 2026-10-14 | 430 | Layout only | 54 source files; not evaluated further |
| [Mastershort/neonplan3d](https://github.com/Mastershort/neonplan3d) | MIT | 2026-11-08 | 1084 | Layout only | Contains `custom_components` and `hacs.json` (Home Assistant), wrong domain |
| [therealMRBK/NextFloor](https://github.com/therealMRBK/NextFloor) | MIT | 2026-11-08 | 121 | Layout only | Same layout and shared copyright with neonplan3d, wrong domain |
| [furnishup/blueprint3d](https://github.com/furnishup/blueprint3d) | MIT | 2021-01-20 | 1999 | Metadata only | Unmaintained |
| [cvdlab/react-planner](https://github.com/cvdlab/react-planner) | MIT | 2024-04-20 | 1492 | Metadata only | Inactive since 2024 |
| [gkjohnson/three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) | MIT | 2026-11-08 | 2032 | Used by foundation | **Selected path tracer** |
| [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT | 2026-11-08 | 117876 | Used by foundation | **Selected 3D engine** |
| [BabylonJS/Babylon.js](https://github.com/BabylonJS/Babylon.js) | Apache-2.0 | 2026-11-07 | 26306 | Metadata only | Foundation is built on three.js |
| [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber) | MIT | 2026-10-21 | 33584 | Metadata only | Foundation does not use React |
| [donalffons/opencascade.js](https://github.com/donalffons/opencascade.js) | LGPL-2.1 | 2023-08-15 | 943 | Metadata only | Inactive; LGPL obligations; B-rep not needed for parametric scope |
| [ThatOpen/engine_components](https://github.com/ThatOpen/engine_components) | MIT | 2026-11-08 | 733 | Metadata only | Candidate for future IFC work |
| [konvajs/konva](https://github.com/konvajs/konva) | API reports NOASSERTION | 2026-11-05 | 14926 | Metadata only | Foundation has its own canvas renderer |
| [fabricjs/fabric.js](https://github.com/fabricjs/fabric.js) | MIT | 2026-11-05 | 31549 | Metadata only | Foundation has its own canvas renderer |

The brief's `OpenPlan3D/OpenPlan3D` path returns 404. The project lives at `laanlabs/openPlan3D`;
its `package.json` names `theLodgeBots/open3dFloorplan` as the repository.

## Finalist comparison

| Criterion | openPlan3D | Pascal editor |
|---|---|---|
| Stack | SvelteKit 2, Svelte 5, Vite 7, three 0.182, npm | Turborepo, Bun 1.4.4, Next 16, React 19, R3F, three 0.187, WebGPU |
| Runs on this machine as-is | Yes (Node 24.18.0) | No: needs Node >=24.22.1 and Bun |
| Size | 542 TypeScript files | 4193 source files counted |
| 2D | Canvas editor with walls, openings, stairs, columns, measurements, layers, background image | Floorplan panel; depth not assessed |
| Export | SVG, DXF, PDF, PNG, JSON, per its README | IFC converter present; other formats not assessed |
| Path tracing | `three-gpu-pathtracer` 0.0.24, isolated in `/render-lab` | None found |
| Governance | Community MIT project | MIT, with a private repo and hosted product steering it |
| Integration difficulty | Medium: very large components | High: size and toolchain |

## Later dependency: PDF reading

`pdfjs-dist` 5.7.284 (Apache-2.0, compatible with this MIT project when its licence notice is kept) reads uploaded floor plan PDFs. It loads only when a PDF is opened.

## Baseline of the selected foundation (actually run, commit 98f9cb4)

- `npm ci --ignore-scripts`: 261 packages installed.
- `vitest run`: 1594 of 1596 tests passed; 163 of 164 files passed.
- Both failures are in `tests/skill-examples.test.ts`. With `core.autocrlf=true`, `SKILL.md` is checked out
  with CRLF while the test regex expects `\n`. This is a Windows checkout artifact.
- `vite build`: succeeded.
- 334 test files were counted in `src` and `tests`, while Vitest ran 164. The remainder were not classified;
  `tests/browser` Playwright specs are among them and have not been run yet.

## Licence analysis

- Foundation code: MIT. `LICENSE` must be retained in the fork.
- Bundled models: 204 GLB files. The foundation's `docs/furniture-inventory.md` records Kenney Furniture Kit and
  Nature Kit as CC0, with notices in `static/models/`. Models it marks unverified must not be presented as licensed.
- `opencascade.js` (LGPL-2.1) is not used.
- No SketchUp or Enscape code or assets are used.

## Decision

Fork openPlan3D. A four-voice council unanimously chose it, with two voices making that conditional on spikes.

| Gate | Status |
|---|---|
| Baseline tests and build pass | Passed, with the explained CRLF failures |
| Firebase not required offline | Passed by inspection: analytics plus one iOS import link |
| Asset licences checked separately | Passed for Kenney packs, by the foundation's own records |
| Path tracer renders a real project scene | Passed in `tests/browser/cabinet-path-trace.spec.ts`, Chromium with SwiftShader software WebGL, at least 1 sample. Image is noisy and undenoised. The blue ground plane seen at first was later fixed. No GPU hardware tested yet |
| One parametric cabinet in 2D, 3D and path-traced view from one store entry | Passed in the same spec: 3:1 footprint in 2D, 10 tagged panels in the traced scene. At the time the cabinet was loaded from a project file; the Build tab placing tool and properties panel were added later and are covered by `tests/browser/full-workflow.spec.ts` |

The first attempt failed because the tracer needs CPU-readable environment pixels and the viewer's sky is a canvas texture. `progressiveRender.ts` now passes a linear half-float copy.

Fallback, had these gates failed: a new Vite application reusing openPlan3D's MIT modules.

## Architectural decisions

1. `Project` in `src/lib/models/types.ts` remains the single source of truth. Both views derive from it.
2. Parametric cabinetry becomes a first-class model element in its own modules, with thin hooks in
   `FloorPlanCanvas.svelte` and `ThreeViewer.svelte`.
3. Push/pull is scoped to parameter-backed extrusions (walls, slabs, recesses, cabinets, custom solids).
   Free-form face editing needs a mesh or B-rep kernel and is out of scope.
4. Rendering is hybrid: the existing rasterised viewer for interaction, `three-gpu-pathtracer` (WebGL 2) for
   progressive high quality, with a rasterised fallback when path tracing fails.
5. Upstream Firebase analytics is removed, so the fork sends no usage data to the upstream project.
   The `?import=CODE` link import still fetches from the upstream storage bucket, only when a page is opened
   with that parameter. It must be removed or repointed before any public deployment.

## Main technical risks

- `FloorPlanCanvas.svelte` (4320 lines) and `ThreeViewer.svelte` (2537 lines) are costly to change safely.
- `three-gpu-pathtracer` 0.0.24 is pre-1.0 and unproven against project scenes under three 0.182.
- `rebuildScene` rebuilds on signature change, which may limit edit performance on large plans.
- Existing tests may not cover new behaviour in the two large components.
