import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

async function exported(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8')).floors[0];
}

async function openEditor(page: Page, file: string) {
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
  await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
  await expect(page.getByTestId('model-toolbar')).toBeVisible();
  return canvas;
}

test('draw on a face, push/pull by typed distance, undo, and push a wall', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const base = JSON.parse(await readFile('tests/fixtures/sloped-walls.openplan.json', 'utf8'));
  base.floors[0].walls = base.floors[0].walls.map(({ startHeight: _s, endHeight: _e, ...rest }: Record<string, unknown>) => ({ ...rest, height: 280 }));
  const file = testInfo.outputPath('modeling.openplan.json');
  await writeFile(file, JSON.stringify(base));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  const canvas = await openEditor(page, file);
  const box = (await canvas.boundingBox())!;
  const at = (fx: number, fy: number) => page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  const distance = page.getByTestId('model-distance');

  // Draw a typed rectangle on whatever surface is at the screen centre.
  await page.getByTestId('model-tool-rectangle').click();
  await at(0.5, 0.55);
  await distance.fill('120, 60');
  await distance.press('Enter');
  await expect(page.getByTestId('model-tool-pushpull')).toHaveAttribute('aria-pressed', 'true');

  // The drawn outline flows straight into push/pull; 80 cm added to its 1 cm start.
  await distance.fill('80');
  await distance.press('Enter');
  await expect(page.getByTestId('model-error')).toHaveCount(0);

  let floor = await exported(page);
  expect(floor.solids).toHaveLength(1);
  expect(floor.solids[0].depth).toBeCloseTo(81);
  const xs = floor.solids[0].profile.map((p: { x: number }) => p.x);
  const ys = floor.solids[0].profile.map((p: { y: number }) => p.y);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(120);
  expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(60);
  await canvas.screenshot({ path: testInfo.outputPath('solid.png') });

  // Every step is its own undo entry.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  floor = await exported(page);
  expect(floor.solids[0].depth).toBeCloseTo(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  floor = await exported(page);
  expect(floor.solids ?? []).toHaveLength(0);

  // Bad input leaves the operation open and the model alone.
  await page.getByTestId('model-tool-rectangle').click();
  await at(0.5, 0.55);
  await distance.fill('nonsense');
  await distance.press('Enter');
  await expect(page.getByTestId('model-error')).toBeVisible();
  await distance.press('Escape');
  await distance.press('Escape');
  await expect(page.getByTestId('model-tool-select')).toHaveAttribute('aria-pressed', 'true');

  // Scan up the view until a click lands on a wall: floor clicks are refused, so a live readout means a wall.
  await page.getByTestId('model-tool-pushpull').click();
  for (const fy of [0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15]) {
    await at(0.5, fy);
    if (await page.getByTestId('model-readout').count()) break;
  }
  await expect(page.getByTestId('model-readout')).toBeVisible();
  await distance.fill('10');
  await distance.press('Enter');
  await expect(page.getByTestId('model-error')).toHaveCount(0);
  floor = await exported(page);
  const changed = floor.walls.filter((w: { thickness: number; height: number }) => w.thickness !== 20 || w.height !== 280);
  expect(changed).toHaveLength(1);
  expect(changed[0].thickness === 30 || changed[0].height === 290).toBe(true);
  expect(errors).toEqual([]);
});
