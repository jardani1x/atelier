import { describe, expect, it } from 'vitest';
import { cmPerPixelFrom, detectFloorPlan, draftToElements, type PlanRaster } from '$lib/utils/floorPlanDetect';
import { detectRooms } from '$lib/utils/roomDetection';

function paper(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const raster: PlanRaster = { width, height, data };
  const rect = (x: number, y: number, w: number, h: number, shade = 0) => {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
      const i = (row * width + col) * 4;
      data[i] = data[i + 1] = data[i + 2] = shade;
    }
  };
  return { raster, rect };
}

/** 1 px = 1 cm. A 600 x 400 outline split by a partition, with a door gap and a glazed window gap. */
function twoRoomPlan() {
  const { raster, rect } = paper(800, 600);
  rect(100, 100, 300, 20);        // top wall, left of window
  rect(520, 100, 200, 20);        // top wall, right of window
  for (let x = 400; x < 520; x += 1) { rect(x, 106, 1, 2); rect(x, 112, 1, 2); } // glazing lines
  rect(100, 500, 620, 20);        // bottom
  rect(100, 100, 20, 420);        // left
  rect(700, 100, 20, 420);        // right
  rect(400, 120, 15, 150);        // partition above door
  rect(400, 360, 15, 140);        // partition below door
  return raster;
}

describe('floor plan detection', () => {
  it('finds outer walls, a partition, one door and one window with real widths', () => {
    const draft = detectFloorPlan(twoRoomPlan(), 1);
    expect(draft.walls).toHaveLength(5);
    const door = draft.openings.find(o => o.kind === 'door');
    const window = draft.openings.find(o => o.kind === 'window');
    expect(door?.width).toBeCloseTo(90, 0);
    expect(window?.width).toBeCloseTo(120, 0);
    expect(draft.coverage).toBeGreaterThan(0.9);
  });

  it('builds closed rooms from walls that meet exactly', () => {
    const raster = twoRoomPlan();
    const elements = draftToElements(detectFloorPlan(raster, 1), raster, 1, (() => { let n = 0; return () => `id${++n}`; })());
    expect(detectRooms(elements.walls)).toHaveLength(2);
    expect(elements.doors).toHaveLength(1);
    expect(elements.doors[0].type).toBe('single');
    expect(elements.windows).toHaveLength(1);
  });

  it('scales output by the calibration and centres it on the image', () => {
    const raster = twoRoomPlan();
    const elements = draftToElements(detectFloorPlan(raster, 1), raster, 2, () => 'x');
    const xs = elements.walls.flatMap(w => [w.start.x, w.end.x]);
    expect(Math.min(...xs)).toBe((110 - 400) * 2);
    expect(Math.max(...xs)).toBe((710 - 400) * 2);
  });

  it('ignores thin dimension lines and text-sized marks', () => {
    const { raster, rect } = paper(800, 600);
    rect(100, 100, 600, 20); rect(100, 480, 600, 20); rect(100, 100, 20, 400); rect(680, 100, 20, 400);
    rect(100, 60, 600, 1);
    for (let x = 200; x < 500; x += 12) rect(x, 300, 6, 2);
    const draft = detectFloorPlan(raster, 1);
    expect(draft.walls).toHaveLength(4);
    expect(draft.walls.every(w => w.thickness >= 15)).toBe(true);
  });

  it('reads outlined walls drawn as two thin faces', () => {
    const { raster, rect } = paper(800, 600);
    const hollow = (x: number, y: number, w: number, h: number) => {
      rect(x, y, w, 2); rect(x, y + h - 2, w, 2); rect(x, y, 2, h); rect(x + w - 2, y, 2, h);
    };
    hollow(100, 100, 600, 20); hollow(100, 480, 600, 20); hollow(100, 100, 20, 400); hollow(680, 100, 20, 400);
    expect(detectFloorPlan(raster, 1).walls.length).toBeGreaterThanOrEqual(4);
  });

  it('does not invent straight walls from a diagonal wall', () => {
    const { raster, rect } = paper(800, 800);
    for (let i = 0; i < 500; i++) rect(100 + i, 100 + i, 20, 20);
    expect(detectFloorPlan(raster, 1).walls).toHaveLength(0);
  });

  it('returns nothing for blank paper', () => {
    expect(detectFloorPlan(paper(300, 300).raster, 1)).toEqual({ walls: [], openings: [], coverage: 0 });
  });

  it('computes scale from two points and rejects unusable input', () => {
    expect(cmPerPixelFrom({ x: 0, y: 0 }, { x: 300, y: 400 }, 1000)).toBe(2);
    expect(cmPerPixelFrom({ x: 5, y: 5 }, { x: 5, y: 5 }, 100)).toBeNull();
    expect(cmPerPixelFrom({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toBeNull();
  });
});
