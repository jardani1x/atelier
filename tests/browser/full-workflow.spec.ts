import { expect, test, type Download } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read = async (download: Download) => readFile((await download.path())!);

function glbJson(glb: Buffer) {
  expect(glb.toString('latin1', 0, 4)).toBe('glTF');
  const length = glb.readUInt32LE(12);
  expect(glb.toString('latin1', 16, 20)).toBe('JSON');
  return JSON.parse(glb.toString('utf8', 20, 20 + length));
}

test('designs a room from template to render, export and reload', async ({ page }) => {
  test.setTimeout(420_000);
  await page.addInitScript(() => {
    localStorage.setItem('o3d_tips_seen', JSON.stringify(['first-wall', 'first-furniture', 'first-3d', 'first-export', 'first-door']));
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/editor');

  let projectId = '';
  async function exportedFloor() {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    const project = JSON.parse((await read(await pending)).toString('utf8'));
    projectId = project.id;
    return project.floors[0];
  }

  await page.getByRole('button', { name: 'Rooms', exact: true }).click();
  const planCanvas = page.getByLabel('Floor plan editor canvas', { exact: true });
  const bounds = (await planCanvas.boundingBox())!;
  const roomCentre = { x: bounds.width / 2 + 100, y: bounds.height / 2 + 50 };
  await page.getByRole('button', { name: /Bedroom 5 items$/ }).dragTo(planCanvas, { targetPosition: roomCentre });
  expect((await exportedFloor()).walls).toHaveLength(4);

  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByTestId('cabinet-preset-wardrobe').click();
  await planCanvas.click({ position: roomCentre });
  await expect(page.getByTestId('cabinet-properties')).toBeVisible();
  await page.getByTestId('cabinet-material').selectOption('marbleWhite');

  const furnished = await exportedFloor();
  expect(furnished.cabinets).toHaveLength(1);
  expect(furnished.cabinets[0]).toMatchObject({ color: '#f2efe9', roughness: 0.12, metalness: 0 });

  await page.getByRole('button', { name: '3D', exact: true }).click();
  const viewer = page.locator('canvas[data-plan3d-canvas="true"]');
  await expect(viewer).toBeVisible({ timeout: 60_000 });

  const glbDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export 3D model as GLB', exact: true }).click();
  const gltf = glbJson(await read(await glbDownload));
  expect(gltf.meshes.length).toBeGreaterThan(10);
  // Marble's 0.12 is divided by the roughness map centre (0.8), and the photo's maps must survive export.
  expect(gltf.materials.some((material: any) => Math.abs(material.pbrMetallicRoughness?.roughnessFactor - 0.15) < 0.001
    && material.pbrMetallicRoughness?.baseColorTexture && material.pbrMetallicRoughness?.metallicRoughnessTexture && material.normalTexture)).toBe(true);

  const objDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export 3D model as OBJ', exact: true }).click();
  expect((await read(await objDownload)).toString('utf8')).toMatch(/^v -?\d/m);
  expect(await viewer.getAttribute('data-export-error')).toBeNull();

  await page.getByRole('button', { name: 'Render', exact: true }).click();
  await page.getByTestId('render-quality').selectOption('performance');
  await expect(viewer).toHaveAttribute('data-trace-key', 'performance/day', { timeout: 120_000 });
  await expect.poll(async () => Number(await viewer.getAttribute('data-trace-samples') ?? 0), { timeout: 180_000 }).toBeGreaterThanOrEqual(2);
  expect(await viewer.getAttribute('data-trace-error')).toBeNull();
  const pngDownload = page.waitForEvent('download');
  await page.getByTestId('render-save').click();
  expect([...(await read(await pngDownload)).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved ✓', { exact: true })).toBeVisible();
  await page.goto(`/editor?id=${projectId}`);
  expect(await exportedFloor()).toEqual(furnished);
  expect(errors).toEqual([]);
});
