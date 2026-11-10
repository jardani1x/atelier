import { test, expect, type Locator } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function meanBrightness(canvas: Locator) {
  return canvas.evaluate((node: HTMLCanvasElement) => {
    const probe = document.createElement('canvas');
    probe.width = probe.height = 64;
    const ctx = probe.getContext('2d')!;
    ctx.drawImage(node, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) total += data[i] + data[i + 1] + data[i + 2];
    return total / (data.length / 4) / 3;
  });
}

async function waitForSamples(canvas: Locator, key: string) {
  await expect(canvas).toHaveAttribute('data-trace-key', key, { timeout: 120_000 });
  await expect.poll(async () => Number(await canvas.getAttribute('data-trace-samples') ?? 0), { timeout: 120_000 }).toBeGreaterThanOrEqual(2);
}

test('render mode traces day and night lighting and saves a PNG', async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const project = await readFile(resolve('tests/fixtures/sloped-walls.openplan.json'), 'utf8');
  const file = testInfo.outputPath('render.openplan.json');
  await writeFile(file, project);
  await page.addInitScript(() => {
    localStorage.setItem('o3d_tips_seen', JSON.stringify(['first-wall', 'first-furniture', 'first-3d', 'first-export', 'first-door']));
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/editor');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click();
  await (await chooser).setFiles(file);

  await page.getByRole('button', { name: 'Render', exact: true }).click();
  const canvas = page.locator('canvas[data-plan3d-canvas="true"]');
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('render-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Path Trace', exact: true })).toHaveCount(0);

  await page.getByTestId('render-quality').selectOption('performance');
  await waitForSamples(canvas, 'performance/day');
  const day = await meanBrightness(canvas);

  await page.getByTestId('render-lighting').selectOption('night');
  await waitForSamples(canvas, 'performance/night');
  const night = await meanBrightness(canvas);
  expect(await canvas.getAttribute('data-trace-error')).toBeNull();
  expect(night).toBeLessThan(day * 0.7);

  const download = page.waitForEvent('download');
  await page.getByTestId('render-save').click();
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/\.png$/i);
  const png = await readFile(await saved.path());
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('render-panel')).toHaveCount(0);
  await expect(canvas).not.toHaveAttribute('data-trace-samples', /.+/);
  expect(errors).toEqual([]);
});
