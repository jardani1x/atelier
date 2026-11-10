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

  it('finds thin partitions beside thick walls, pale glazing, and a door hung against a crossing wall', () => {
    const { raster, rect } = paper(800, 600);
    rect(100, 100, 200, 24); rect(450, 100, 274, 24);   // top wall either side of the window
    rect(300, 107, 150, 2, 170); rect(300, 115, 150, 2, 170); // glazing too pale to count as ink
    rect(100, 500, 624, 24); rect(100, 100, 24, 424); rect(700, 100, 24, 424);
    rect(400, 124, 8, 376);                             // thin partition, full height
    rect(124, 300, 186, 8);                             // thin partition that stops short for a door
    for (let step = 0; step <= 180; step++) {           // swing arc about the jamb at x = 310
      const angle = step * Math.PI / 360;
      rect(Math.round(310 + 90 * Math.cos(angle)), Math.round(304 + 90 * Math.sin(angle)), 2, 2, 120);
    }
    const draft = detectFloorPlan(raster, 1);
    expect(draft.walls).toHaveLength(6);
    expect(draft.walls.filter(wall => wall.thickness < 12)).toHaveLength(2);
    const doors = draft.openings.filter(o => o.kind === 'door');
    const windows = draft.openings.filter(o => o.kind === 'window');
    expect(doors).toHaveLength(1);
    expect(doors[0].width).toBeCloseTo(90, 0);
    expect(draft.walls[doors[0].wall].thickness).toBeLessThan(12);
    expect(windows).toHaveLength(1);
    expect(windows[0].width).toBeCloseTo(150, 0);
  });

  it('leaves a blank gap open as a passage on a plan that draws its door swings', () => {
    const { raster, rect } = paper(800, 600);
    rect(100, 100, 624, 24); rect(100, 500, 624, 24); rect(100, 100, 24, 424); rect(700, 100, 24, 424);
    rect(400, 124, 12, 100); rect(400, 344, 12, 156);   // partition with a blank 120 cm gap
    const swing = (hinge: number, y: number) => {
      for (let step = 0; step <= 180; step++) {
        const angle = step * Math.PI / 360;
        rect(Math.round(hinge + 90 * Math.cos(angle)), Math.round(y + 90 * Math.sin(angle)), 2, 2, 120);
      }
    };
    rect(124, 300, 66, 12); rect(280, 300, 120, 12); swing(190, 306); // left room, door with swing
    rect(412, 300, 78, 12); rect(580, 300, 120, 12); swing(490, 306); // right room, door with swing
    const draft = detectFloorPlan(raster, 1);
    expect(draft.openings.filter(o => o.kind === 'door')).toHaveLength(2);
    const partition = draft.walls.filter(wall => wall.start.x === wall.end.x && wall.thickness < 20);
    expect(partition).toHaveLength(2);
    expect(draft.openings.every(o => !partition.includes(draft.walls[o.wall]))).toBe(true);
  });

  it('does not read a room label beyond a wall end as a window', () => {
    const { raster, rect } = paper(800, 600);
    rect(100, 100, 624, 24); rect(100, 500, 624, 24); rect(100, 100, 24, 424); rect(700, 100, 24, 424);
    rect(400, 300, 300, 8);                             // partition that ends in the open room
    for (let x = 180; x < 340; x += 12) rect(x, 296, 5, 16); // lettering in line with it
    const draft = detectFloorPlan(raster, 1);
    expect(draft.openings).toHaveLength(0);
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
