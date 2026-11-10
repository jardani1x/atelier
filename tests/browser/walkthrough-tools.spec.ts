import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const position = async (canvas: Locator) => {
  const value = await canvas.getAttribute('data-walk-position');
  const [x, z] = (value ?? '0,0').split(',').map(Number);
  return { x, z };
};

async function sprintForward(page: Page, milliseconds: number) {
  await page.keyboard.down('Shift');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(milliseconds);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(500);
}

function jpegSize(bytes: Buffer) {
  let offset = 2;
  while (offset < bytes.length) {
    const marker = bytes[offset + 1];
    if (marker >= 0xc0 && marker <= 0xc2) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  throw new Error('No JPEG frame header found');
}

test('collision keeps the walker inside a room and a 360 panorama downloads', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const project = JSON.parse(await readFile('tests/fixtures/sloped-walls.openplan.json', 'utf8'));
  const floor = project.floors[0];
  floor.doors = floor.windows = floor.furniture = [];
  floor.walls = floor.walls.map(({ startHeight: _s, endHeight: _e, ...rest }: Record<string, unknown>) => ({ ...rest, height: 280 }));
  const file = testInfo.outputPath('walk.openplan.json');
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
  await page.getByRole('button', { name: 'Enter Walkthrough Mode', exact: true }).click();

  const toggle = page.getByRole('button', { name: /Collision \(C\)/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  const start = await (async () => {
    await page.keyboard.press('ArrowUp');
    await expect(canvas).toHaveAttribute('data-walk-position', /.+/, { timeout: 30_000 });
    return position(canvas);
  })();

  // The room is 600 x 400, so a long sprint in a straight line must reach a wall.
  await sprintForward(page, 8_000);
  const blocked = await position(canvas);
  expect(blocked.x).toBeGreaterThanOrEqual(0);
  expect(blocked.x).toBeLessThanOrEqual(600);
  expect(blocked.z).toBeGreaterThanOrEqual(0);
  expect(blocked.z).toBeLessThanOrEqual(400);
  expect(Math.hypot(blocked.x - start.x, blocked.z - start.z)).toBeGreaterThan(50);

  const download = page.waitForEvent('download', { timeout: 200_000 });
  await page.keyboard.press('KeyP');
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/-360\.jpg$/);
  const bytes = await readFile((await saved.path())!);
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  expect(jpegSize(bytes)).toEqual({ width: 4096, height: 2048 });
  expect(bytes.toString('latin1')).toContain('GPano:ProjectionType="equirectangular"');
  const colours = await page.evaluate(async base64 => {
    const blob = await (await fetch(`data:image/jpeg;base64,${base64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const surface = new OffscreenCanvas(64, 32);
    const context = surface.getContext('2d')!;
    context.drawImage(bitmap, 0, 0, 64, 32);
    const { data } = context.getImageData(0, 0, 64, 32);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return seen.size;
  }, bytes.toString('base64'));
  expect(colours).toBeGreaterThan(20);
  await page.screenshot({ path: testInfo.outputPath('after-panorama.png') });

  // Without collision the same walk passes through the wall.
  await page.keyboard.press('KeyC');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await sprintForward(page, 8_000);
  const free = await position(canvas);
  expect(free.x < 0 || free.x > 600 || free.z < 0 || free.z > 400).toBe(true);
  expect(errors).toEqual([]);
});
