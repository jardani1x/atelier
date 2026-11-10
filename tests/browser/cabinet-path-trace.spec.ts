import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('one stored cabinet appears in 2D, 3D and the path-traced scene', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const project = JSON.parse(await readFile(resolve('tests/fixtures/sloped-walls.openplan.json'), 'utf8'));
  project.floors[0].cabinets = [{
    id: 'spike-cabinet', position: { x: 200, y: 150 }, rotation: 0, width: 180, height: 220, depth: 60, thickness: 2,
    compartments: 2, shelves: [0.5], doors: 'hinged', color: '#b08d62', roughness: 0.5, metalness: 0,
  }];
  const file = testInfo.outputPath('cabinet.openplan.json');
  await writeFile(file, JSON.stringify(project));

  await page.addInitScript(() => {
    localStorage.setItem('o3d_tips_seen', JSON.stringify(['first-wall', 'first-furniture', 'first-3d', 'first-export', 'first-door']));
    const fillRect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
      if (this.globalAlpha === 0.35) ((window as any).__cabinetFills ??= []).push({ w, h });
      return fillRect.call(this, x, y, w, h);
    };
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().startsWith('Path trace failed')) console.log(message.text()); });
  await page.goto('/editor');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click();
  await (await chooser).setFiles(file);

  await expect.poll(() => page.evaluate(() => (window as any).__cabinetFills?.length ?? 0)).toBeGreaterThan(0);
  const fill = await page.evaluate(() => (window as any).__cabinetFills.at(-1));
  expect(fill.w / fill.h).toBeCloseTo(180 / 60, 3);

  await page.getByRole('button', { name: '3D', exact: true }).click();
  const canvas = page.locator('canvas[data-plan3d-canvas="true"]');
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Path Trace', exact: true }).click();
  // 2 sides, top, bottom, back, 1 divider, 2 shelves, 2 doors.
  await expect(canvas).toHaveAttribute('data-trace-cabinet-panels', '10', { timeout: 120_000 });
  await expect.poll(async () => Number(await canvas.getAttribute('data-trace-samples') ?? 0), { timeout: 120_000 }).toBeGreaterThanOrEqual(1);

  const stats = await canvas.evaluate((node: HTMLCanvasElement) => {
    const probe = document.createElement('canvas');
    probe.width = 64; probe.height = 64;
    const ctx = probe.getContext('2d')!;
    ctx.drawImage(node, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return { colours: seen.size, error: node.dataset.traceError ?? null };
  });
  expect(stats.error).toBeNull();
  expect(stats.colours).toBeGreaterThan(10);
  await canvas.screenshot({ path: testInfo.outputPath('path-trace.png') });
  expect(errors).toEqual([]);
});
