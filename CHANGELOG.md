# Changelog

Changes made for ATELIER on top of OpenPlan3D commit 98f9cb4. Nothing here is committed to git yet.

## Unreleased

### Added
- Floor plan import: upload a PDF or image, or paste a screenshot, set scale from two clicked points, review detected walls, doors and windows over the original, then build editable walls as one undo step. Runs in the browser using pdf.js.
- Optional Supabase sign-in and cloud save and load, with row-level security schema and revision conflict checks. See `CLOUD_SETUP.md`.
- 3D modelling tools in Edit Mode: rectangle, circle and polygon drawn on any face, and push/pull on drawn solids, walls (side and top) and cabinets, with typed distances and one undo step per action.
- Render mode using three-gpu-pathtracer, with quality presets and day/night settings.
- Parametric cabinets: Build tab presets, placement on the plan, properties panel, 13 PBR finishes.
- GLB and OBJ model export from the 3D viewer.
- Front, side, isometric and fit camera views.
- Typed wall lengths with units, so `3500 mm` gives a 3.5 m wall.
- Illustrative 4-room HDB flat template.
- End-to-end browser test of the room design workflow.
- Texture, normal and roughness maps on wall, floor and cabinet finishes. Normal and roughness maps are estimated from image brightness, not scanned.
- Render panel: denoiser, ceiling lights with colour temperature and intensity, Full HD and 4K output widths.
- Walkthrough collision with walls, windows, cabinets, columns, furniture and drawn solids, toggled with C. Doorways stay open and low or ceiling-mounted objects do not block.
- 360 panorama export from walkthrough (P): 4096 x 2048 equirectangular JPEG with photo sphere metadata, rasterised.
- Saved views in the 3D viewer: save, rename, go to and delete named camera positions, stored in the project.
- Video tour export along saved views, recorded from the rasterised view (WebM in Chromium).
- Orthographic toggle for orbit view.
- Save As: copy the project under a typed name.
- Optional bloom and ambient occlusion in the interactive 3D view, off by default.
- Project documents: `ARCHITECTURE.md`, `CHANGELOG.md`, `LIMITATIONS.md`, `EVALUATION.md`, `RESEARCH.md`.

### Changed
- Product name in the title and user-facing locale strings is now ATELIER. `LIMITATIONS.md` lists what still says OpenPlan3D.

### Fixed
- Path-traced scenes gave meshes the wrong materials, differently on each run, whenever any mesh had per-face materials.
- Sky no longer passes through ceilings when the render camera is inside a room.
- Blue ground plane in path-traced scenes.
- Escape now cancels cabinet placement.
- Loading a project no longer adds an empty `solids` list to every floor.
- A second saved view now appears in the list straight away.
