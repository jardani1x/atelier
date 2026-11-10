# Evaluation

Self-assessment by the implementing agent, dated 2026-11-09. Scores are judgement against the brief, not independent review.

## Test results

Environment: Windows 11, Node 24.18.0, Playwright Chromium with SwiftShader software WebGL. No real GPU was used.

| Check | Result |
|---|---|
| `svelte-check` | 0 errors, 0 warnings |
| Vitest | 1740 passed, 2 failed of 1742. Both failures are in `tests/skill-examples.test.ts` and were attributed to CRLF line endings in the upstream skill file |
| `vite build` | Passed |
| Playwright, full run before floor plan import | 440 passed, 24 failed, 1 skipped. The failures were at the end of the run, when the test server went down during a rebuild |
| Playwright, rerun of those spec files plus `floor-plan-import.spec.ts` | 22 passed, 6 failed |
| Those 6 failures, rerun from temporary copies with hardcoded port 4188 changed to the test port | 5 passed, 1 failed |
| `tests/browser/floor-plan-import.spec.ts` | 3 passed: PNG, second page of a PDF, unsupported file. Plans are synthetic |

Open failure: `viewer-resources.spec.ts`, "camera previews release resources" at 390px, failed in 3 of 3 runs with "Target page, context or browser has been closed". The cause has not been found, and it has not been established whether ATELIER changes caused it. The 1440px variant passes.

Caveat: the full browser suite has not been run as one pass since floor plan import was added. Spec files with `4188` need a temporary port change to pass while that port is taken.

## Scores

| Area | Score | Evidence |
|---|---|---|
| Open-source research | 7 | `RESEARCH.md` compares repositories, licences and risks |
| Quality of selected foundation | 8 | OpenPlan3D is MIT and shipped most 2D and 3D editing with a large test suite |
| 2D drafting | 7 | Foundation tools, typed `3500 mm` verified in browser. Calibration workflow not newly tested |
| 3D modelling | 5 | Generated architecture, furniture, parametric cabinets, and face drawing with push/pull work (unit and browser tests). Drawn shapes are single extrusions: no boolean cuts, no free 3D line tool, orthographic in orbit view only |
| 2D/3D sync | 8 | One store drives all views; workflow test confirms cabinet in 2D, 3D, export and render |
| Realistic rendering | 6 | Real progressive path tracing with texture maps, denoiser, ceiling lights, colour temperature and up to 4K output. Bloom and ambient occlusion in the interactive view only. Never run on a GPU |
| Interface usability | 6 | Workflow is usable and tested. A toolbar overflow at 390 px was found and fixed late; no human usability testing |
| Application performance | 2 | No measured FPS on real hardware. Only software WebGL runs exist |
| Import/export compatibility | 5 | JSON, GLB and OBJ tested by parsing output, not opened in other applications. No IFC, STL or SKP |
| Code architecture | 7 | Additions are small modules on the existing store. Some OpenPlan3D naming and Firebase references remain |
| Testing and reliability | 7 | Large automated suites and an end-to-end workflow. No full single pass after final changes, no GPU coverage |

## Overall

ATELIER is a working floor planner with connected 3D, parametric cabinets and a real path tracer. It is not a replacement for SketchUp Pro, Enscape, 3ds Max, Corona or V-Ray. See `LIMITATIONS.md`.
