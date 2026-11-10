import { test, expect, type Locator } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const lumaGrid = (canvas: Locator) => canvas.evaluate((element) => {
  const source = element as HTMLCanvasElement;
  const copy = document.createElement('canvas');
  copy.width = 400;
  copy.height = Math.round(400 * source.height / source.width);
  const context = copy.getContext('2d')!;
  context.drawImage(source, 0, 0, copy.width, copy.height);
  const { data } = context.getImageData(0, 0, copy.width, copy.height);
  const luma: number[] = [];
  for (let index = 0; index < data.length; index += 4) luma.push(0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]);
  return luma;
});
const darkened = (before: number[], after: number[], levels: number) => before.filter((value, index) => value - after[index] > levels).length;
const largestChange = (before: number[], after: number[]) => before.reduce((largest, value, index) => Math.max(largest, Math.abs(value - after[index])), 0);

test('bloom and ambient occlusion toggle changes the image and switches back cleanly', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const project = JSON.parse(await readFile('tests/fixtures/sloped-walls.openplan.json', 'utf8'));
  const floor = project.floors[0];
  floor.doors = floor.windows = floor.furniture = [];
  floor.walls = floor.walls.map(({ startHeight: _s, endHeight: _e, ...rest }: Record<string, unknown>) => ({ ...rest, height: 280 }));
  const file = testInfo.outputPath('effects.openplan.json');
  await writeFile(file, JSON.stringify(project));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem('o3d_tips_seen', JSON.stringify(['first-wall', 'first-furniture', 'first-3d', 'first-export', 'first-door']));
  });
  await page.goto('/editor');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click();
  await (await chooser).setFiles(file);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const canvas = page.locator('canvas[data-plan3d-canvas="true"]');
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  await expect(canvas).toHaveAttribute('data-rendered', 'true', { timeout: 60_000 });
  await page.waitForTimeout(2000);

  const plain = await lumaGrid(canvas);
  await page.screenshot({ path: testInfo.outputPath('effects-off.png') });

  const toggle = page.getByRole('button', { name: 'Bloom and ambient occlusion', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveAttribute('data-viewport-effects', 'on', { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const withEffects = await lumaGrid(canvas);
  await page.screenshot({ path: testInfo.outputPath('effects-on.png') });
  const shaded = darkened(plain, withEffects, 12);
  expect(shaded, 'pixels darkened by ambient occlusion').toBeGreaterThan(100);

  // Orthographic needs a composer built for that camera.
  const ortho = page.getByRole('button', { name: 'Orthographic view', exact: true });
  await ortho.click();
  await expect(canvas).toHaveAttribute('data-projection', 'orthographic');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: testInfo.outputPath('effects-ortho.png') });
  await expect(canvas).toHaveAttribute('data-viewport-effects', 'on');
  await ortho.click();
  await expect(canvas).toHaveAttribute('data-projection', 'perspective');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(canvas).toHaveAttribute('data-viewport-effects', 'off', { timeout: 60_000 });
  await page.waitForTimeout(1000);
  expect(largestChange(plain, await lumaGrid(canvas)), 'image returns to the plain render').toBeLessThan(3);
  expect(errors).toEqual([]);
});
