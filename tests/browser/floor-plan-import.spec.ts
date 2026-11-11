import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { jsPDF } from 'jspdf';

/** 800 x 600 sheet: two rooms, one door gap in the partition, one glazed gap in the top wall. */
const RECTS: [number, number, number, number][] = [
  [100, 100, 300, 20], [520, 100, 200, 20], [400, 106, 120, 2], [400, 112, 120, 2],
  [100, 500, 620, 20], [100, 100, 20, 420], [700, 100, 20, 420], [400, 120, 15, 150], [400, 360, 15, 140],
];

async function openEditor(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('o3d_tips_seen', JSON.stringify(['first-wall', 'first-furniture', 'first-3d', 'first-export', 'first-door']));
    localStorage.setItem('hasSeenWelcome', 'true');
  });
  await page.goto('/editor');
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('button', { name: /Floor plan to walls/ }).click();
}

async function detect(page: Page, file: string, pdfPage?: { number: number; of: number }) {
  await page.getByTestId('plan-file').setInputFiles(file);
  const canvas = page.getByTestId('plan-canvas');
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  if (pdfPage) {
    const before = await canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL());
    await page.getByLabel(`Page (of ${pdfPage.of})`).fill(String(pdfPage.number));
    await page.getByLabel(`Page (of ${pdfPage.of})`).blur();
    await expect.poll(() => canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL()), { timeout: 60_000 }).not.toBe(before);
  }
  // Detection runs by itself with an estimated scale; step back to measure the real one.
  await expect(page.getByTestId('plan-estimated')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Set exact scale', exact: true }).click();
  const box = (await canvas.boundingBox())!;
  // Outer face to outer face along the bottom wall is 620 sheet units: call that 6.2 m.
  await canvas.click({ position: { x: box.width * 100 / 800, y: box.height * 510 / 600 } });
  await canvas.click({ position: { x: box.width * 720 / 800, y: box.height * 510 / 600 } });
  await page.getByTestId('plan-distance').fill('6.2 m');
  await page.getByRole('button', { name: 'Detect walls', exact: true }).click();
  await expect(page.getByTestId('plan-counts')).toHaveText('Found 5 walls, 1 doors, 1 windows', { timeout: 60_000 });
}

async function exported(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8')).floors[0];
}

async function buildAndCheck(page: Page) {
  await page.getByRole('button', { name: 'Build walls', exact: true }).click();
  await expect(page.getByTestId('plan-canvas')).toHaveCount(0);
  const floor = await exported(page);
  expect(floor.walls).toHaveLength(5);
  expect(floor.doors).toHaveLength(1);
  expect(floor.windows).toHaveLength(1);
  const xs = floor.walls.flatMap((wall: { start: { x: number }; end: { x: number } }) => [wall.start.x, wall.end.x]);
  // Centre lines of the outer walls sit one wall thickness inside the 620 cm overall width.
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(590);
  expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(610);
  expect(floor.doors[0].width).toBeGreaterThan(80);
  expect(floor.doors[0].width).toBeLessThan(100);
  expect(floor.backgroundImage.dataUrl).toMatch(/^data:image\/(png|jpeg);base64,/);
}

test('builds walls, doors and windows from a PNG', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openEditor(page);
  const dataUrl = await page.evaluate((rects) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff'; context.fillRect(0, 0, 800, 600);
    context.fillStyle = '#000';
    for (const [x, y, w, h] of rects) context.fillRect(x, y, w, h);
    return canvas.toDataURL('image/png');
  }, RECTS);
  const file = testInfo.outputPath('plan.png');
  await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  await detect(page, file);
  await buildAndCheck(page);
  expect(errors).toEqual([]);
});

test('detects walls as soon as an image is imported, with no calibration', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('o3d_tips_seen', JSON.stringify(['first-wall', 'first-furniture', 'first-3d', 'first-export', 'first-door']));
    localStorage.setItem('hasSeenWelcome', 'true');
  });
  await page.goto('/editor');
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  const dataUrl = await page.evaluate((rects) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 600;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff'; context.fillRect(0, 0, 800, 600);
    context.fillStyle = '#000';
    for (const [x, y, w, h] of rects) context.fillRect(x, y, w, h);
    return canvas.toDataURL('image/png');
  }, RECTS);
  const file = testInfo.outputPath('plan.png');
  await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  // The plain image import on an empty floor goes straight to detection.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Import Image/ }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByTestId('plan-counts')).toHaveText('Found 5 walls, 1 doors, 1 windows', { timeout: 60_000 });
  await expect(page.getByTestId('plan-estimated')).toBeVisible();
  await page.getByRole('button', { name: 'Build walls', exact: true }).click();
  const floor = await exported(page);
  expect(floor.walls).toHaveLength(5);
  expect(floor.doors).toHaveLength(1);
  // The single door sets the scale: it comes out as a standard door.
  expect(floor.doors[0].width).toBeGreaterThan(75);
  expect(floor.doors[0].width).toBeLessThan(95);
});

test('builds walls from the chosen page of a PDF', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openEditor(page);
  const pdf = new jsPDF({ unit: 'pt', format: [800, 600], orientation: 'landscape' });
  pdf.addPage([800, 600], 'landscape');
  for (const [x, y, w, h] of RECTS) pdf.rect(x, y, w, h, 'F');
  const file = testInfo.outputPath('plan.pdf');
  await writeFile(file, Buffer.from(pdf.output('arraybuffer')));
  await detect(page, file, { number: 2, of: 2 });
  await buildAndCheck(page);
  expect(errors).toEqual([]);
});

test('explains an unsupported file and keeps the dialog usable', async ({ page }, testInfo) => {
  await openEditor(page);
  const file = testInfo.outputPath('notes.txt');
  await writeFile(file, 'not a plan');
  await page.getByTestId('plan-file').setInputFiles(file);
  await expect(page.getByRole('alert')).toContainText('Use a PDF, PNG, JPEG, WebP, GIF or BMP file.');
  await expect(page.getByRole('button', { name: 'Choose PDF or image', exact: true })).toBeEnabled();
});
