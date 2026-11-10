import { expect, test } from '@playwright/test';
import { copyFile } from 'node:fs/promises';

// Not an assertion of appearance: writes an interior image for a person to judge. Run with RENDER_LOOK=<path prefix>.
test('captures an interior view for visual review', async ({ page }) => {
  test.skip(!process.env.RENDER_LOOK, 'visual capture only');
  test.setTimeout(560_000);
  await page.setViewportSize({ width: 900, height: 560 });
  await page.addInitScript(() => {
    localStorage.setItem('o3d_tips_seen', JSON.stringify(['first-wall', 'first-furniture', 'first-3d', 'first-export', 'first-door']));
  });
  await page.goto('/editor');
  await page.getByRole('button', { name: 'Rooms', exact: true }).click();
  const planCanvas = page.getByLabel('Floor plan editor canvas', { exact: true });
  const bounds = (await planCanvas.boundingBox())!;
  await page.getByRole('button', { name: /Bedroom 5 items$/ }).dragTo(planCanvas, { targetPosition: { x: bounds.width / 2, y: bounds.height / 2 } });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const viewer = page.locator('canvas[data-plan3d-canvas="true"]');
  await expect(viewer).toBeVisible({ timeout: 60_000 });
  const box = (await viewer.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -240);
  await page.waitForTimeout(1500);
  await viewer.screenshot({ path: `${process.env.RENDER_LOOK}-raster.png` });

  await page.getByRole('button', { name: 'Render', exact: true }).click();
  await page.getByTestId('render-quality').selectOption('performance');
  await page.getByTestId('render-ceiling-lights').check();
  for (const lighting of ['night', 'day', 'golden'] as const) {
    await page.getByTestId('render-lighting').selectOption(lighting);
    await expect(viewer).toHaveAttribute('data-trace-key', lighting === 'night' ? 'performance/night/ceiling' : `performance/${lighting}/ceiling`, { timeout: 120_000 });
    await expect.poll(async () => Number(await viewer.getAttribute('data-trace-samples') ?? 0), { timeout: 220_000 }).toBeGreaterThanOrEqual(12);
    const pending = page.waitForEvent('download');
    await page.getByTestId('render-save').click();
    await copyFile((await (await pending).path())!, `${process.env.RENDER_LOOK}-${lighting}.png`);
  }
});

test('adds ceiling lights, denoise and a larger image to a render', async ({ page }) => {
  test.setTimeout(420_000);
  await page.addInitScript(() => {
    localStorage.setItem('o3d_tips_seen', JSON.stringify(['first-wall', 'first-furniture', 'first-3d', 'first-export', 'first-door']));
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/editor');

  await page.getByRole('button', { name: 'Rooms', exact: true }).click();
  const planCanvas = page.getByLabel('Floor plan editor canvas', { exact: true });
  const bounds = (await planCanvas.boundingBox())!;
  await page.getByRole('button', { name: /Bedroom 5 items$/ }).dragTo(planCanvas, { targetPosition: { x: bounds.width / 2 + 100, y: bounds.height / 2 + 50 } });

  await page.getByRole('button', { name: '3D', exact: true }).click();
  const viewer = page.locator('canvas[data-plan3d-canvas="true"]');
  await expect(viewer).toBeVisible({ timeout: 60_000 });
  const screenWidth = Number(await viewer.getAttribute('width'));

  const samples = async () => Number(await viewer.getAttribute('data-trace-samples') ?? 0);
  const traced = async (key: string) => {
    await expect(viewer).toHaveAttribute('data-trace-key', key, { timeout: 120_000 });
    await expect.poll(samples, { timeout: 180_000 }).toBeGreaterThanOrEqual(1);
    expect(await viewer.getAttribute('data-trace-error')).toBeNull();
  };

  await page.getByRole('button', { name: 'Render', exact: true }).click();
  await page.getByTestId('render-quality').selectOption('performance');
  await traced('performance/day');
  expect(await viewer.getAttribute('data-trace-interior-lights')).toBe('0');

  await page.getByTestId('render-ceiling-lights').check();
  await traced('performance/day/ceiling');
  expect(Number(await viewer.getAttribute('data-trace-interior-lights'))).toBeGreaterThanOrEqual(1);

  await page.getByTestId('render-temperature').fill('4000');
  await traced('performance/day/ceiling/4000K');
  await page.getByTestId('render-intensity').fill('2');
  await traced('performance/day/ceiling/4000K/x2');

  // Denoise is a display filter, so toggling keeps the accumulated samples.
  const before = await samples();
  await page.getByTestId('render-denoise').uncheck();
  await expect(viewer).toHaveAttribute('data-trace-key', 'performance/day/ceiling/4000K/x2');
  expect(await samples()).toBeGreaterThanOrEqual(before);
  await page.getByTestId('render-denoise').check();

  await page.getByTestId('render-output').selectOption('1920');
  await traced('performance/day/ceiling/4000K/x2/1920');
  expect(await viewer.getAttribute('width')).toBe('1920');
  const pngDownload = page.waitForEvent('download');
  await page.getByTestId('render-save').click();
  const png = await (await pngDownload).path();
  if (process.env.RENDER_SHOT) await copyFile(png!, process.env.RENDER_SHOT);

  await page.getByTestId('render-output').selectOption('viewport');
  await traced('performance/day/ceiling/4000K/x2');
  expect(Number(await viewer.getAttribute('width'))).toBe(screenWidth);

  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect.poll(() => viewer.getAttribute('data-trace-interior-lights')).toBeNull();
  expect(errors).toEqual([]);
});
