import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const storedProjects = (page: Page) => page.evaluate(async () => {
  const databases = await indexedDB.databases();
  const results: { name: string; savedViews?: unknown[] }[] = [];
  for (const { name } of databases) {
    if (!name) continue;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    if (db.objectStoreNames.contains('projects')) {
      const raw = await new Promise<string[]>((resolve, reject) => {
        const all = db.transaction('projects').objectStore('projects').getAll();
        all.onsuccess = () => resolve(all.result);
        all.onerror = () => reject(all.error);
      });
      results.push(...raw.map(value => JSON.parse(value)));
    }
    db.close();
  }
  return results;
});

test('saved views, orthographic toggle, video tour and Save As work together', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const project = JSON.parse(await readFile('tests/fixtures/sloped-walls.openplan.json', 'utf8'));
  const floor = project.floors[0];
  floor.doors = floor.windows = floor.furniture = [];
  floor.walls = floor.walls.map(({ startHeight: _s, endHeight: _e, ...rest }: Record<string, unknown>) => ({ ...rest, height: 280 }));
  const file = testInfo.outputPath('views.openplan.json');
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

  // Orthographic on and off again.
  const ortho = page.getByRole('button', { name: 'Orthographic view', exact: true });
  await ortho.click();
  await expect(ortho).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveAttribute('data-projection', 'orthographic');
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('orthographic.png') });
  await ortho.click();
  await expect(canvas).toHaveAttribute('data-projection', 'perspective');

  // Two different views.
  await page.getByRole('button', { name: 'Saved views', exact: true }).click();
  const save = page.getByRole('button', { name: 'Save current view', exact: true });
  await save.click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(800);
  await save.click();

  const go = page.getByRole('button', { name: /^Go to / });
  await expect(go).toHaveCount(2);
  await go.nth(0).click();
  await expect(canvas).toHaveAttribute('data-camera-position', /.+/);
  const first = await canvas.getAttribute('data-camera-position');
  await go.nth(1).click();
  await expect(canvas).not.toHaveAttribute('data-camera-position', first!);
  await go.nth(0).click();
  await expect(canvas).toHaveAttribute('data-camera-position', first!);

  // Tour video: real recorder output, not only a file name.
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Export video tour', exact: true }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/-tour\.(webm|mp4)$/);
  const bytes = await readFile((await saved.path())!);
  expect(bytes.length, `${saved.suggestedFilename()} was ${bytes.length} bytes`).toBeGreaterThan(1000);
  if (saved.suggestedFilename().endsWith('.webm')) expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  else expect(bytes.subarray(4, 8).toString('latin1')).toBe('ftyp');
  await expect(canvas).toHaveAttribute('data-camera-position', first!);

  // Save As keeps the views under the typed name.
  await page.getByRole('button', { name: 'Save As', exact: true }).click();
  await page.getByLabel('Project name').fill('Second scheme');
  await page.getByRole('button', { name: 'Save copy', exact: true }).click();
  await expect.poll(async () => (await storedProjects(page)).find(entry => entry.name === 'Second scheme')?.savedViews?.length, { timeout: 15_000 }).toBe(2);
  expect(errors).toEqual([]);
});
