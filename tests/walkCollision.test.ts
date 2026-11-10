import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import type { Floor } from '$lib/models/types';
import { buildWalkObstacles, resolveWalkCollision, WALK_BODY_RADIUS } from '$lib/utils/walkCollision';
import { WalkthroughMotion } from '$lib/utils/walkthroughMotion';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, extra = {}) => ({
  id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 10, height: 280, color: '#fff', ...extra,
});

function floor(parts: Partial<Floor>): Floor {
  return { walls: [], doors: [], windows: [], furniture: [], columns: [], cabinets: [], solids: [], ...parts } as unknown as Floor;
}

const options = { eyeHeight: 160 };

describe('walkthrough obstacles', () => {
  it('blocks a wall and keeps sideways travel', () => {
    const obstacles = buildWalkObstacles(floor({ walls: [wall('w', 0, 0, 400, 0)] as Floor['walls'] }), options);
    const after = resolveWalkCollision(150, 10, obstacles);
    expect(after.x).toBeCloseTo(150);
    expect(after.y).toBeCloseTo(5 + WALK_BODY_RADIUS);
  });

  it('opens a passage at doors and not at windows', () => {
    const walls = [wall('w', 0, 0, 400, 0)] as Floor['walls'];
    const door = { id: 'd', wallId: 'w', position: 0.5, width: 90, height: 210, type: 'single' };
    const window = { id: 'n', wallId: 'w', position: 0.5, width: 90, height: 100, sillHeight: 90 };
    const withDoor = buildWalkObstacles(floor({ walls, doors: [door] as unknown as Floor['doors'] }), options);
    const withWindow = buildWalkObstacles(floor({ walls, windows: [window] as unknown as Floor['windows'] }), options);
    expect(resolveWalkCollision(200, 0, withDoor)).toEqual({ x: 200, y: 0 });
    expect(resolveWalkCollision(200, 0, withWindow).y).not.toBe(0);
  });

  it('follows a curved wall', () => {
    const walls = [wall('w', 0, 0, 400, 0, { curvePoint: { x: 200, y: 200 } })] as Floor['walls'];
    const obstacles = buildWalkObstacles(floor({ walls }), options);
    // The curve midpoint is at y = 100, away from the straight chord.
    expect(resolveWalkCollision(200, 100, obstacles).y).not.toBeCloseTo(100);
    expect(resolveWalkCollision(200, 0, obstacles)).toEqual({ x: 200, y: 0 });
  });

  it('respects furniture rotation', () => {
    const sofa = { id: 's', catalogId: 'sofa', position: { x: 0, y: 0 }, rotation: 90, scale: { x: 1, y: 1, z: 1 } };
    const obstacles = buildWalkObstacles(floor({ furniture: [sofa] as unknown as Floor['furniture'] }), options);
    // A 200 x 90 sofa turned 90 degrees reaches 100 along plan y and only 45 along plan x.
    expect(resolveWalkCollision(0, 90, obstacles).y).toBeCloseTo(100 + WALK_BODY_RADIUS);
    expect(resolveWalkCollision(80, 0, obstacles)).toEqual({ x: 80, y: 0 });
  });

  it('ignores rugs, plan symbols and ceiling fittings', () => {
    const item = (catalogId: string, extra = {}) => ({ id: catalogId, catalogId, position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, ...extra });
    const furniture = [item('sofa', { height: 5 }), item('sym_pendant'), item('chandelier')] as unknown as Floor['furniture'];
    expect(buildWalkObstacles(floor({ furniture }), options)).toHaveLength(0);
  });

  it('lets a person pass under wall cabinets only when lower than them', () => {
    const cabinet = { id: 'c', position: { x: 0, y: 0 }, rotation: 0, width: 100, height: 70, depth: 35, elevation: 150 };
    const cabinets = [cabinet] as unknown as Floor['cabinets'];
    expect(buildWalkObstacles(floor({ cabinets }), { eyeHeight: 160 })).toHaveLength(1);
    expect(buildWalkObstacles(floor({ cabinets }), { eyeHeight: 120 })).toHaveLength(0);
  });

  it('keeps clear of a round column by its radius', () => {
    const column = { id: 'c', position: { x: 0, y: 0 }, rotation: 0, shape: 'round', diameter: 40, height: 280 };
    const obstacles = buildWalkObstacles(floor({ columns: [column] as unknown as Floor['columns'] }), options);
    const after = resolveWalkCollision(30, 0, obstacles);
    expect(after.x).toBeCloseTo(20 + WALK_BODY_RADIUS);
  });

  it('blocks tall solids and steps over flat ones', () => {
    const base = { id: 's', origin: { x: 0, y: 0, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: -1 }, profile: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], color: '#fff', roughness: 1, metalness: 0 };
    const tall = [{ ...base, depth: 200 }] as Floor['solids'];
    const flat = [{ ...base, depth: 2 }] as Floor['solids'];
    const obstacles = buildWalkObstacles(floor({ solids: tall }), options);
    expect(obstacles).toHaveLength(1);
    expect(obstacles[0]).toMatchObject({ x: 50, y: -50, halfWidth: 50, halfDepth: 50 });
    expect(buildWalkObstacles(floor({ solids: flat }), options)).toHaveLength(0);
  });

  it('ejects a body that starts inside an object', () => {
    const table = { id: 't', catalogId: 'sofa', position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } };
    const obstacles = buildWalkObstacles(floor({ furniture: [table] as unknown as Floor['furniture'] }), options);
    const after = resolveWalkCollision(0, 40, obstacles);
    expect(after.x).toBeCloseTo(0);
    expect(after.y).toBeCloseTo(45 + WALK_BODY_RADIUS);
  });
});

describe('walkthrough motion with collision', () => {
  const settings = { moveSpeed: 800, sprintSpeed: 1600, eyeHeight: 160, floorElevation: 0 };

  it('stops at a wall at any frame rate', () => {
    const obstacles = buildWalkObstacles(floor({ walls: [wall('w', -500, -100, 500, -100)] as Floor['walls'] }), options);
    for (const hz of [10, 60, 240]) {
      const motion = new WalkthroughMotion(), camera = new PerspectiveCamera();
      const collide = (x: number, y: number) => resolveWalkCollision(x, y, obstacles);
      motion.setKey('ArrowUp', true);
      motion.setKey('ShiftLeft', true);
      motion.advance(0, camera, { ...settings, collide });
      for (let frame = 1; frame <= hz * 3; frame++) motion.advance(frame * 1000 / hz, camera, { ...settings, collide });
      expect(camera.position.z).toBeCloseTo(-100 + 5 + WALK_BODY_RADIUS);
    }
  });

  it('corrects the starting position before any input', () => {
    const obstacles = buildWalkObstacles(floor({ walls: [wall('w', -500, 0, 500, 0)] as Floor['walls'] }), options);
    const motion = new WalkthroughMotion(), camera = new PerspectiveCamera();
    camera.position.set(0, 0, 1);
    motion.advance(0, camera, { ...settings, collide: (x, y) => resolveWalkCollision(x, y, obstacles) });
    expect(camera.position.z).toBeCloseTo(5 + WALK_BODY_RADIUS);
  });
});
