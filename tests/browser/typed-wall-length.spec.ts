import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('typing 3500 mm while drawing creates a wall exactly 3.5 m long', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('o3d_tips_seen', JSON.stringify(['first-wall', 'first-furniture', 'first-3d', 'first-export', 'first-door']));
  });
  await page.goto('/editor');
  const canvas = page.getByLabel('Floor plan editor canvas', { exact: true });
  await expect(canvas).toBeVisible();
  await page.keyboard.press('w');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 - 80, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2);
  await page.keyboard.type('3500 mm');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  const project = JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
  const [wall] = project.floors[0].walls;
  expect(project.floors[0].walls).toHaveLength(1);
  expect(Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)).toBeCloseTo(350, 3);
});
