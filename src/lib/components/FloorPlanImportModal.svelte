<script lang="ts">
  import { t } from '$lib/i18n';
  import type { Point } from '$lib/models/types';
  import { loadPlanFile, planDataUrl, PlanFileFailure, type PlanFileError } from '$lib/services/floorPlanFile';
  import { activeFloor, importFloorPlan, setBackgroundImage } from '$lib/stores/project';
  import { parseLengthInput, projectSettings } from '$lib/stores/settings';
  import { autoDetectFloorPlan, cmPerPixelFrom, detectFloorPlan, type PlanDraft } from '$lib/utils/floorPlanDetect';
  import { modalDialog, reconcileNativeClose } from '$lib/utils/modalDialog';

  let { onclose, file }: { onclose: () => void; file?: File } = $props();

  type Problem = PlanFileError | 'nothingFound';
  const LOW_COVERAGE = 0.85;

  let view = $state<HTMLCanvasElement>();
  let picker = $state<HTMLInputElement>();
  let source = $state<File | null>(null);
  let plan = $state<HTMLCanvasElement | null>(null);
  let pages = $state(1);
  let page = $state(1);
  let points = $state<Point[]>([]);
  let distance = $state('');
  let draft = $state<PlanDraft | null>(null);
  let cmPerPixel = $state(1);
  /** True while the draft uses a guessed scale rather than one the user measured. */
  let estimated = $state(false);
  let busy = $state(false);
  let problem = $state<Problem | null>(null);

  const distanceCm = $derived(parseLengthInput(distance, $projectSettings.units));
  const scale = $derived(points.length === 2 && distanceCm !== null ? cmPerPixelFrom(points[0], points[1], distanceCm) : null);
  const floorHasWalls = $derived(($activeFloor?.walls.length ?? 0) > 0);
  const doorCount = $derived(draft?.openings.filter(o => o.kind === 'door').length ?? 0);
  const windowCount = $derived(draft?.openings.filter(o => o.kind === 'window').length ?? 0);

  async function open(file: File, pageNumber = 1) {
    busy = true; problem = null;
    try {
      const loaded = await loadPlanFile(file, pageNumber);
      source = file; plan = loaded.canvas; pages = loaded.pages; page = pageNumber;
      points = []; draft = null;
      // Let the plan paint before the synchronous image work starts.
      await new Promise(resolve => setTimeout(resolve));
      autoDetect(loaded.canvas);
    } catch (error) {
      problem = error instanceof PlanFileFailure ? error.code : 'unreadable';
    } finally {
      busy = false;
    }
  }

  /** Detects straight away with an estimated scale. A plan it cannot read is left for manual calibration. */
  function autoDetect(canvas: HTMLCanvasElement) {
    try {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const result = context && autoDetectFloorPlan(context.getImageData(0, 0, canvas.width, canvas.height));
      if (result) { draft = result.draft; cmPerPixel = result.cmPerPixel; estimated = true; }
    } catch (error) {
      console.error('Automatic floor plan detection failed', error);
    }
  }

  $effect(() => { if (file) void open(file); });

  function pasted(event: ClipboardEvent) {
    const file = [...(event.clipboardData?.files ?? [])].find(item => item.type.startsWith('image/'));
    if (file) { event.preventDefault(); void open(file); }
  }

  function clicked(event: MouseEvent) {
    if (!view || !plan || draft) return;
    const box = view.getBoundingClientRect();
    const point = { x: (event.clientX - box.left) * plan.width / box.width, y: (event.clientY - box.top) * plan.height / box.height };
    points = points.length === 1 ? [points[0], point] : [point];
  }

  async function detect() {
    if (!plan || !scale) return;
    busy = true; problem = null;
    // Let the busy state paint before the synchronous image work starts.
    await new Promise(resolve => setTimeout(resolve));
    try {
      const context = plan.getContext('2d', { willReadFrequently: true });
      if (!context) { problem = 'unreadable'; return; }
      const result = detectFloorPlan(context.getImageData(0, 0, plan.width, plan.height), scale);
      if (result.walls.length) { draft = result; cmPerPixel = scale; estimated = false; }
      else problem = 'nothingFound';
    } catch (error) {
      console.error('Floor plan detection failed', error);
      problem = 'unreadable';
    } finally {
      busy = false;
    }
  }

  function build() {
    if (!plan || !draft || floorHasWalls) return;
    importFloorPlan(draft, plan, cmPerPixel, {
      dataUrl: planDataUrl(plan), position: { x: 0, y: 0 }, scale: cmPerPixel, opacity: 0.4, rotation: 0, locked: true,
    });
    onclose();
  }

  function backgroundOnly() {
    if (!plan) return;
    setBackgroundImage({ dataUrl: planDataUrl(plan), position: { x: 0, y: 0 }, scale: draft ? cmPerPixel : scale ?? 1, opacity: 0.4, rotation: 0, locked: false });
    onclose();
  }

  $effect(() => {
    if (!view || !plan) return;
    const context = view.getContext('2d');
    if (!context) return;
    view.width = plan.width; view.height = plan.height;
    context.drawImage(plan, 0, 0);
    const mark = Math.max(plan.width, plan.height) / 200;
    if (draft) {
      context.lineCap = 'butt';
      context.strokeStyle = 'rgba(37, 99, 235, 0.6)';
      for (const wall of draft.walls) {
        context.lineWidth = Math.max(mark / 2, wall.thickness);
        context.beginPath(); context.moveTo(wall.start.x, wall.start.y); context.lineTo(wall.end.x, wall.end.y); context.stroke();
      }
      for (const opening of draft.openings) {
        const wall = draft.walls[opening.wall];
        const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
        const ux = (wall.end.x - wall.start.x) / length, uy = (wall.end.y - wall.start.y) / length;
        const x = wall.start.x + ux * length * opening.center, y = wall.start.y + uy * length * opening.center;
        context.strokeStyle = opening.kind === 'door' ? '#16a34a' : '#ea580c';
        context.lineWidth = Math.max(mark, wall.thickness);
        context.beginPath();
        context.moveTo(x - ux * opening.width / 2, y - uy * opening.width / 2);
        context.lineTo(x + ux * opening.width / 2, y + uy * opening.width / 2);
        context.stroke();
      }
    } else if (points.length) {
      context.strokeStyle = context.fillStyle = '#dc2626';
      context.lineWidth = mark / 2;
      context.beginPath(); context.moveTo(points[0].x, points[0].y);
      if (points[1]) context.lineTo(points[1].x, points[1].y);
      context.stroke();
      for (const point of points) { context.beginPath(); context.arc(point.x, point.y, mark, 0, Math.PI * 2); context.fill(); }
    }
  });
</script>

<svelte:window onpaste={pasted} />

<dialog use:modalDialog aria-labelledby="plan-import-title"
  oncancel={(event) => { if (busy) event.preventDefault(); else onclose(); }}
  onclose={(event) => reconcileNativeClose(event, busy, onclose)}
  class="m-auto w-[56rem] max-w-[calc(100vw-2rem)] max-h-[90vh] rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-black/50">
  <div class="flex max-h-[90vh] flex-col text-gray-800">
    <div class="flex items-center justify-between gap-4 border-b border-gray-100 px-5 py-4">
      <h2 id="plan-import-title" class="text-base font-semibold">{$t('floorPlanImport.title')}</h2>
      <button class="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100" disabled={busy} onclick={onclose}>{$t('floorPlanImport.close')}</button>
    </div>

    <div class="min-h-0 flex-1 overflow-auto px-5 py-4 text-sm">
      <input bind:this={picker} data-testid="plan-file" type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp" class="hidden"
        onchange={() => { const file = picker?.files?.[0]; if (file) void open(file); if (picker) picker.value = ''; }} />

      {#if !plan}
        <p class="mb-3 text-gray-600">{$t('floorPlanImport.intro')}</p>
        <button class="w-full rounded-xl border-2 border-dashed border-gray-300 px-4 py-10 font-medium hover:bg-gray-50" disabled={busy} onclick={() => picker?.click()}>
          {busy ? $t('floorPlanImport.working') : $t('floorPlanImport.choose')}
        </button>
        <p class="mt-3 text-xs text-gray-500">{$t('floorPlanImport.bestOn')}</p>
      {:else}
        <p class="mb-2 text-gray-600" role="status">
          {#if draft}{$t('floorPlanImport.reviewHelp')}{:else if points.length < 2}{$t(points.length ? 'floorPlanImport.secondPoint' : 'floorPlanImport.firstPoint')}{:else}{$t('floorPlanImport.enterDistance')}{/if}
        </p>
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
        <canvas bind:this={view} data-testid="plan-canvas" aria-label={$t('floorPlanImport.canvas')} onclick={clicked}
          class="mx-auto block max-h-[55vh] max-w-full border border-gray-200 {draft ? '' : 'cursor-crosshair'}"></canvas>

        {#if draft}
          <p class="mt-3 font-medium" data-testid="plan-counts">{$t('floorPlanImport.found', { walls: draft.walls.length, doors: doorCount, windows: windowCount })}</p>
          <p class="mt-1 text-xs text-gray-500">{$t('floorPlanImport.legend')}</p>
          {#if estimated}<p class="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900" role="status" data-testid="plan-estimated">{$t('floorPlanImport.estimated', { width: Math.round(plan.width * cmPerPixel / 10) / 10, height: Math.round(plan.height * cmPerPixel / 10) / 10 })}</p>{/if}
          {#if draft.coverage < LOW_COVERAGE}<p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">{$t('floorPlanImport.lowCoverage')}</p>{/if}
          {#if floorHasWalls}<p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">{$t('floorPlanImport.floorNotEmpty')}</p>{/if}
        {:else}
          <div class="mt-3 flex flex-wrap items-end gap-3">
            <label class="text-xs font-medium text-gray-600">{$t('floorPlanImport.distance')}
              <input bind:value={distance} data-testid="plan-distance" placeholder={$t('floorPlanImport.distanceExample')} class="mt-1 block w-40 rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
            </label>
            {#if pages > 1 && source}
              <label class="text-xs font-medium text-gray-600">{$t('floorPlanImport.page', { pages })}
                <input type="number" min="1" max={pages} value={page} disabled={busy} class="mt-1 block w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  onchange={(event) => { const next = Number(event.currentTarget.value); if (source && next >= 1 && next <= pages) void open(source, next); }} />
              </label>
            {/if}
          </div>
        {/if}
      {/if}

      {#if problem}<p class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">{$t(`floorPlanImport.error.${problem}`)}</p>{/if}
    </div>

    {#if plan}
      <div class="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
        <button class="mr-auto rounded-lg px-3 py-2 text-sm hover:bg-gray-100" disabled={busy} onclick={backgroundOnly}>{$t('floorPlanImport.backgroundOnly')}</button>
        {#if draft}
          <button class="rounded-lg px-3 py-2 text-sm hover:bg-gray-100" onclick={() => draft = null}>{$t(estimated ? 'floorPlanImport.setScale' : 'floorPlanImport.back')}</button>
          <button class="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={floorHasWalls} onclick={build}>{$t('floorPlanImport.build')}</button>
        {:else}
          <button class="rounded-lg px-3 py-2 text-sm hover:bg-gray-100" disabled={busy} onclick={() => picker?.click()}>{$t('floorPlanImport.other')}</button>
          <button class="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy || !scale} onclick={detect}>{busy ? $t('floorPlanImport.working') : $t('floorPlanImport.detect')}</button>
        {/if}
      </div>
    {/if}
  </div>
</dialog>
