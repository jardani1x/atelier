import { describe, expect, it } from 'vitest';
import type { Cabinet, Floor, Solid, Wall } from '$lib/models/types';
import { getWallEndHeight } from '$lib/models/types';
import {
  circleProfile, faceOfTriangle, findSolidAt, planeAxes, pushPullCabinet, pushPullSolid, pushPullWall,
  rectangleProfile, signedArea, solidFootprint, solidMesh, solidNormal, validProfile, validSolid,
} from '$lib/utils/solids';
import { createSolidModel } from '$lib/utils/solidModel3d';

function floorSolid(overrides: Partial<Solid> = {}): Solid {
  return {
    id: 's', origin: { x: 0, y: 0, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: -1 },
    profile: rectangleProfile({ x: 0, y: 0 }, { x: 100, y: 50 }), depth: 10,
    color: '#ffffff', roughness: 0.5, metalness: 0, ...overrides,
  };
}

function wall(id: string, start: [number, number], end: [number, number], overrides: Partial<Wall> = {}): Wall {
  return { id, start: { x: start[0], y: start[1] }, end: { x: end[0], y: end[1] }, thickness: 10, height: 280, color: '#fff', ...overrides };
}

function plan(walls: Wall[], extra: Partial<Floor> = {}) {
  return { walls, doors: [], windows: [], ...extra } as Pick<Floor, 'walls' | 'doors' | 'windows'>;
}

const cabinet = (overrides: Partial<Cabinet> = {}) => ({
  id: 'c', position: { x: 0, y: 0 }, rotation: 0, width: 100, height: 200, depth: 60, thickness: 1.8, compartments: 1, shelves: [], doors: 'none',
  color: '#000', roughness: 0.5, metalness: 0, ...overrides,
}) as Cabinet;

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('planeAxes', () => {
  it.each([[{ x: 0, y: 1, z: 0 }], [{ x: 1, y: 0, z: 0 }], [{ x: 0, y: 0, z: -1 }], [{ x: 0.6, y: 0, z: 0.8 }]])('builds right-handed axes for %j', (normal) => {
    const { u, v } = planeAxes(normal);
    const n = solidNormal({ u, v });
    expect(n.x).toBeCloseTo(normal.x); expect(n.y).toBeCloseTo(normal.y); expect(n.z).toBeCloseTo(normal.z);
  });

  it('keeps u horizontal on a wall so shapes stay level', () => {
    expect(planeAxes({ x: 1, y: 0, z: 0 }).u.y).toBe(0);
  });
});

describe('profiles', () => {
  it('winds rectangles counter-clockwise whichever way they are dragged', () => {
    expect(signedArea(rectangleProfile({ x: 100, y: 50 }, { x: 0, y: 0 }))).toBe(5000);
  });

  it('rejects self-crossing and tiny shapes', () => {
    expect(validProfile([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(false);
    expect(validProfile(rectangleProfile({ x: 0, y: 0 }, { x: 0.1, y: 0.1 }))).toBe(false);
    expect(validProfile(circleProfile({ x: 0, y: 0 }, 20))).toBe(true);
  });

  it('rejects corrupt saved shapes', () => {
    expect(validSolid(floorSolid())).toBe(true);
    expect(validSolid(floorSolid({ depth: NaN }))).toBe(false);
    expect(validSolid(floorSolid({ profile: [] }))).toBe(false);
    expect(validSolid(floorSolid({ u: { x: 0, y: 0, z: 0 } }))).toBe(false);
  });
});

describe('solidMesh', () => {
  it('has outward normals on every face', () => {
    const solid = floorSolid();
    const { positions, capTriangles } = solidMesh(solid);
    const count = positions.length / 9;
    expect(capTriangles).toBe(2);
    expect(count).toBe(2 * capTriangles + 2 * solid.profile.length);
    const centre = { x: 50, y: 5, z: -25 };
    for (let t = 0; t < count; t++) {
      const p = (i: number) => ({ x: positions[t * 9 + i * 3], y: positions[t * 9 + i * 3 + 1], z: positions[t * 9 + i * 3 + 2] });
      const [a, b, c] = [p(0), p(1), p(2)];
      const e1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, e2 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
      const n = { x: e1.y * e2.z - e1.z * e2.y, y: e1.z * e2.x - e1.x * e2.z, z: e1.x * e2.y - e1.y * e2.x };
      expect(n.x * (a.x - centre.x) + n.y * (a.y - centre.y) + n.z * (a.z - centre.z)).toBeGreaterThan(0);
    }
  });

  it('maps triangles back to faces', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 11].map(t => faceOfTriangle(t, 2))).toEqual(['top', 'top', 'base', 'base', 0, 0, 1, 3]);
  });

  it('tags the mesh so the viewer can find the solid', () => {
    const mesh = createSolidModel(floorSolid());
    expect(mesh.userData).toEqual({ solidId: 's', capTriangles: 2 });
    expect(mesh.geometry.getAttribute('normal').count).toBe(mesh.geometry.getAttribute('position').count);
  });
});

describe('pushPullSolid', () => {
  it('moves the top without moving the base', () => {
    expect(unwrap(pushPullSolid(floorSolid(), 'top', 35))).toEqual({ depth: 45 });
  });

  it('moves the base and keeps the top fixed', () => {
    const solid = floorSolid();
    const update = unwrap(pushPullSolid(solid, 'base', 5));
    expect(update.depth).toBe(15);
    expect(update.origin!.y + update.depth!).toBeCloseTo(solid.origin.y + solid.depth);
  });

  it('moves one side and leaves the opposite side', () => {
    const update = unwrap(pushPullSolid(floorSolid(), 1, 20));
    expect(update.profile).toEqual([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 50 }, { x: 0, y: 50 }]);
  });

  it('keeps a slanted neighbouring edge on its own line', () => {
    const solid = floorSolid({ profile: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 80, y: 50 }, { x: 0, y: 50 }] });
    const profile = unwrap(pushPullSolid(solid, 0, 10)).profile!;
    expect(profile[0]).toEqual({ x: 0, y: -10 });
    expect(profile[1].x).toBeCloseTo(104);
    expect(profile[1].y).toBeCloseTo(-10);
  });

  it('changes the radius of a circle uniformly', () => {
    const solid = floorSolid({ curved: true, profile: circleProfile({ x: 0, y: 0 }, 20) });
    const profile = unwrap(pushPullSolid(solid, 3, 5)).profile!;
    for (const p of profile) expect(Math.hypot(p.x, p.y)).toBeCloseTo(25);
  });

  it('refuses to collapse a shape or change a locked one', () => {
    expect(pushPullSolid(floorSolid(), 'top', -10)).toEqual({ ok: false, error: 'tooSmall' });
    expect(pushPullSolid(floorSolid(), 1, -100)).toEqual({ ok: false, error: 'tooSmall' });
    expect(pushPullSolid(floorSolid(), 'top', 5000)).toEqual({ ok: false, error: 'tooLarge' });
    expect(pushPullSolid(floorSolid({ locked: true }), 'top', 5)).toEqual({ ok: false, error: 'locked' });
  });
});

describe('pushPullCabinet', () => {
  it('keeps the far face fixed when widening', () => {
    const update = unwrap(pushPullCabinet(cabinet(), 'x', 1, 20));
    expect(update.width).toBe(120);
    expect(update.position!.x + -update.width! / 2).toBeCloseTo(-50);
  });

  it('follows rotation', () => {
    const update = unwrap(pushPullCabinet(cabinet({ rotation: 90 }), 'x', 1, 20));
    expect(update.position!.x).toBeCloseTo(0);
    expect(update.position!.y).toBeCloseTo(10);
  });

  it('raises the top alone, and lowers the bottom through elevation', () => {
    expect(unwrap(pushPullCabinet(cabinet(), 'y', 1, 10))).toEqual({ height: 210 });
    expect(unwrap(pushPullCabinet(cabinet({ elevation: 30 }), 'y', -1, 10))).toEqual({ height: 210, elevation: 20 });
  });

  it('enforces limits and locks', () => {
    expect(pushPullCabinet(cabinet(), 'x', 1, -95).ok).toBe(false);
    expect(pushPullCabinet(cabinet(), 'y', -1, 10)).toEqual({ ok: false, error: 'tooLarge' });
    expect(pushPullCabinet(cabinet({ locked: true }), 'x', 1, 5)).toEqual({ ok: false, error: 'locked' });
  });
});

describe('pushPullWall', () => {
  it('thickens toward the pushed side and keeps the opposite face fixed', () => {
    const w = wall('w', [0, 0], [100, 0]);
    const update = unwrap(pushPullWall(plan([w]), w, 'side', 1, 10)).get('w')!;
    expect(update.thickness).toBe(20);
    expect(update.start).toEqual({ x: 0, y: 5 });
    expect(update.start!.y - update.thickness! / 2).toBeCloseTo(w.start.y - w.thickness / 2);
  });

  it('carries joined wall endpoints so corners stay closed', () => {
    const w = wall('w', [0, 0], [100, 0]);
    const joined = wall('j', [100, 0], [100, 100]);
    const apart = wall('a', [300, 300], [400, 300]);
    const updates = unwrap(pushPullWall(plan([w, joined, apart]), w, 'side', -1, 10));
    expect(updates.get('j')).toEqual({ start: { x: 100, y: -5 } });
    expect(updates.has('a')).toBe(false);
  });

  it('raises a sloped top and keeps its slope', () => {
    const w = wall('w', [0, 0], [100, 0], { startHeight: 200, endHeight: 260 });
    const update = unwrap(pushPullWall(plan([w]), w, 'top', 1, 20)).get('w')!;
    expect(update).toMatchObject({ startHeight: 220, endHeight: 280 });
    expect(getWallEndHeight({ ...w, ...update })).toBe(280);
  });

  it('refuses a top below an opening, and curved or too-thin walls', () => {
    const w = wall('w', [0, 0], [100, 0]);
    const withDoor = plan([w], { doors: [{ wallId: 'w', height: 210 }] as Floor['doors'] });
    expect(pushPullWall(withDoor, w, 'top', 1, -80)).toEqual({ ok: false, error: 'belowOpening' });
    expect(pushPullWall(plan([w]), wall('c', [0, 0], [100, 0], { curvePoint: { x: 50, y: 40 } }), 'side', 1, 5)).toEqual({ ok: false, error: 'curvedWall' });
    expect(pushPullWall(plan([w]), w, 'side', 1, -9)).toEqual({ ok: false, error: 'tooSmall' });
  });
});

describe('plan view', () => {
  it('uses the exact outline of a shape on the floor', () => {
    expect(solidFootprint(floorSolid())).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: -50 }, { x: 0, y: -50 }]);
  });

  it('finds the topmost shape under a point', () => {
    const a = floorSolid({ id: 'a' }), b = floorSolid({ id: 'b' });
    expect(findSolidAt({ x: 50, y: -25 }, [a, b])?.id).toBe('b');
    expect(findSolidAt({ x: 500, y: 0 }, [a, b])).toBeNull();
  });
});
