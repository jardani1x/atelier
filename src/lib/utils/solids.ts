import { ShapeUtils, Vector2 } from 'three';
import type { Cabinet, Floor, Point, Solid, SolidVector, Wall } from '$lib/models/types';
import { getWallEndHeight, getWallStartHeight } from '$lib/models/types';
import { CABINET_LIMITS } from '$lib/utils/cabinetGeometry';

export const SOLID_LIMITS = { minDepth: 0.1, maxDepth: 2000, minEdge: 0.5, minArea: 0.25, circleSegments: 32 } as const;
export const WALL_PUSH_LIMITS = { minThickness: 2, maxThickness: 150, minHeight: 20, maxHeight: 1000 } as const;
/** Wall endpoints this close (cm) count as joined and move together. */
const JOIN_TOLERANCE = 0.5;

export type SolidFace = 'top' | 'base' | number;
export type PushPullTarget =
  | { kind: 'solid'; id: string; face: SolidFace }
  | { kind: 'cabinet'; id: string; axis: 'x' | 'y' | 'z'; sign: 1 | -1 }
  | { kind: 'wall'; id: string; face: 'top' | 'side'; sign: 1 | -1 };
export type PushPullError = 'tooSmall' | 'tooLarge' | 'curvedWall' | 'belowOpening' | 'invalidShape' | 'locked' | 'missing';
export type PushPullResult<T> = { ok: true; value: T } | { ok: false; error: PushPullError };

const fail = (error: PushPullError) => ({ ok: false, error }) as const;
const add = (a: SolidVector, b: SolidVector, s = 1): SolidVector => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const cross = (a: SolidVector, b: SolidVector): SolidVector => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
function unit(v: SolidVector): SolidVector {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

export function solidNormal(solid: Pick<Solid, 'u' | 'v'>): SolidVector {
  return unit(cross(solid.u, solid.v));
}

/** Right-handed in-plane axes for a face normal, with u horizontal on walls so drawn shapes stay level. */
export function planeAxes(normal: SolidVector): { u: SolidVector; v: SolidVector } {
  const n = unit(normal);
  const u = Math.abs(n.y) > 0.99 ? { x: 1, y: 0, z: 0 } : unit(cross({ x: 0, y: 1, z: 0 }, n));
  return { u, v: unit(cross(n, u)) };
}

export function signedArea(profile: Point[]): number {
  let area = 0;
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i], b = profile[(i + 1) % profile.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(c, d, a), d2 = side(c, d, b), d3 = side(a, b, c), d4 = side(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** A profile must be finite, wound counter-clockwise, non-degenerate and free of self-crossings. */
export function validProfile(profile: Point[]): boolean {
  if (profile.length < 3 || profile.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  if (signedArea(profile) < SOLID_LIMITS.minArea) return false;
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const a = profile[i], b = profile[(i + 1) % n];
    if (Math.hypot(b.x - a.x, b.y - a.y) < SOLID_LIMITS.minEdge) return false;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(a, b, profile[j], profile[(j + 1) % n])) return false;
    }
  }
  return true;
}

export function normalizeProfile(profile: Point[]): Point[] {
  return signedArea(profile) < 0 ? [...profile].reverse() : profile;
}

export function rectangleProfile(a: Point, b: Point): Point[] {
  return normalizeProfile([{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }]);
}

export function circleProfile(center: Point, radius: number): Point[] {
  return Array.from({ length: SOLID_LIMITS.circleSegments }, (_, i) => {
    const angle = (i / SOLID_LIMITS.circleSegments) * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}

export function validSolid(solid: Solid): boolean {
  const finite = (v: SolidVector) => [v?.x, v?.y, v?.z].every(value => Number.isFinite(value));
  return finite(solid.origin) && finite(solid.u) && finite(solid.v) && Number.isFinite(solid.depth)
    && solid.depth >= SOLID_LIMITS.minDepth && Math.hypot(...Object.values(cross(solid.u, solid.v))) > 0.5
    && Array.isArray(solid.profile) && validProfile(solid.profile);
}

export function solidPoint(solid: Pick<Solid, 'origin' | 'u' | 'v'>, p: Point, height: number): SolidVector {
  return add(add(add(solid.origin, solid.u, p.x), solid.v, p.y), solidNormal(solid), height);
}

export interface SolidMesh {
  positions: number[];
  /** Texture coordinates in centimetres. */
  uvs: number[];
  capTriangles: number;
}

/** Flat-shaded triangles: top caps, then base caps, then two per profile edge. */
export function solidMesh(solid: Solid): SolidMesh {
  const contour = solid.profile.map(p => new Vector2(p.x, p.y));
  const caps = ShapeUtils.triangulateShape(contour, []).map(([a, b, c]) => {
    const [pa, pb, pc] = [solid.profile[a], solid.profile[b], solid.profile[c]];
    return (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x) < 0 ? [a, c, b] : [a, b, c];
  });
  const positions: number[] = [], uvs: number[] = [];
  const emit = (p: Point, height: number, uvX: number, uvY: number) => {
    const world = solidPoint(solid, p, height);
    positions.push(world.x, world.y, world.z);
    uvs.push(uvX, uvY);
  };
  for (const [a, b, c] of caps) for (const i of [a, b, c]) emit(solid.profile[i], solid.depth, solid.profile[i].x, solid.profile[i].y);
  for (const [a, b, c] of caps) for (const i of [c, b, a]) emit(solid.profile[i], 0, solid.profile[i].x, solid.profile[i].y);
  let along = 0;
  solid.profile.forEach((a, i) => {
    const b = solid.profile[(i + 1) % solid.profile.length];
    const next = along + Math.hypot(b.x - a.x, b.y - a.y);
    emit(a, 0, along, 0); emit(b, 0, next, 0); emit(b, solid.depth, next, solid.depth);
    emit(a, 0, along, 0); emit(b, solid.depth, next, solid.depth); emit(a, solid.depth, along, solid.depth);
    along = next;
  });
  return { positions, uvs, capTriangles: caps.length };
}

/** Which face a triangle of `solidMesh` belongs to. */
export function faceOfTriangle(triangle: number, capTriangles: number): SolidFace {
  if (triangle < capTriangles) return 'top';
  if (triangle < capTriangles * 2) return 'base';
  return Math.floor((triangle - capTriangles * 2) / 2);
}

function offsetEdge(profile: Point[], edge: number, distance: number): Point[] {
  const n = profile.length;
  const a = profile[edge], b = profile[(edge + 1) % n];
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const outward = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
  const shift = (p: Point) => ({ x: p.x + outward.x * distance, y: p.y + outward.y * distance });
  // Each moved corner slides along its neighbouring edge, so that edge keeps its direction.
  const slide = (corner: Point, neighbour: Point) => {
    const dx = neighbour.x - corner.x, dy = neighbour.y - corner.y;
    const facing = dx * outward.x + dy * outward.y;
    if (Math.abs(facing) < 1e-6) return shift(corner);
    const t = distance / facing;
    return { x: corner.x + dx * t, y: corner.y + dy * t };
  };
  const next = [...profile];
  next[edge] = slide(a, profile[(edge - 1 + n) % n]);
  next[(edge + 1) % n] = slide(b, profile[(edge + 2) % n]);
  return next;
}

function offsetRadius(profile: Point[], distance: number): Point[] | null {
  const center = profile.reduce((sum, p) => ({ x: sum.x + p.x / profile.length, y: sum.y + p.y / profile.length }), { x: 0, y: 0 });
  const radius = profile.reduce((sum, p) => sum + Math.hypot(p.x - center.x, p.y - center.y), 0) / profile.length;
  if (radius + distance <= 0) return null;
  const scale = (radius + distance) / radius;
  return profile.map(p => ({ x: center.x + (p.x - center.x) * scale, y: center.y + (p.y - center.y) * scale }));
}

/** Moves one face by `distance` along its outward normal; the opposite side stays where it is. */
export function pushPullSolid(solid: Solid, face: SolidFace, distance: number): PushPullResult<Partial<Solid>> {
  if (solid.locked) return fail('locked');
  if (face === 'top' || face === 'base') {
    const depth = solid.depth + distance;
    if (depth < SOLID_LIMITS.minDepth) return fail('tooSmall');
    if (depth > SOLID_LIMITS.maxDepth) return fail('tooLarge');
    return { ok: true, value: face === 'top' ? { depth } : { depth, origin: add(solid.origin, solidNormal(solid), -distance) } };
  }
  if (!Number.isInteger(face) || face < 0 || face >= solid.profile.length) return fail('missing');
  const profile = solid.curved ? offsetRadius(solid.profile, distance) : offsetEdge(solid.profile, face, distance);
  if (!profile) return fail('tooSmall');
  if (signedArea(profile) < SOLID_LIMITS.minArea) return fail('tooSmall');
  if (!validProfile(profile)) return fail('invalidShape');
  return { ok: true, value: { profile } };
}

export function pushPullCabinet(cabinet: Cabinet, axis: 'x' | 'y' | 'z', sign: 1 | -1, distance: number): PushPullResult<Partial<Cabinet>> {
  if (cabinet.locked) return fail('locked');
  const field = axis === 'x' ? 'width' : axis === 'y' ? 'height' : 'depth';
  const size = cabinet[field] + distance;
  if (size < CABINET_LIMITS.minSize) return fail('tooSmall');
  if (size > CABINET_LIMITS.maxSize) return fail('tooLarge');
  if (axis === 'y') {
    if (sign === 1) return { ok: true, value: { height: size } };
    const elevation = (cabinet.elevation ?? 0) - distance;
    return elevation < 0 ? fail('tooLarge') : { ok: true, value: { height: size, elevation } };
  }
  // The body is centred on its position, so moving one face by d moves the centre by d / 2.
  const radians = (cabinet.rotation * Math.PI) / 180;
  const direction = axis === 'x' ? { x: Math.cos(radians), y: Math.sin(radians) } : { x: -Math.sin(radians), y: Math.cos(radians) };
  const shift = (sign * distance) / 2;
  return { ok: true, value: { [field]: size, position: { x: cabinet.position.x + direction.x * shift, y: cabinet.position.y + direction.y * shift } } };
}

/** The plan direction a wall's positive side faces. */
export function wallSideNormal(wall: Pick<Wall, 'start' | 'end'>): Point {
  const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: -dy / length, y: dx / length };
}

export function wallOpeningTop(floor: Pick<Floor, 'doors' | 'windows'>, wallId: string): number {
  return Math.max(0,
    ...floor.doors.filter(d => d.wallId === wallId).map(d => d.height),
    ...floor.windows.filter(w => w.wallId === wallId).map(w => w.sillHeight + w.height));
}

/** Updates per wall. A side push also carries endpoints of joined walls so corners stay closed. */
export function pushPullWall(floor: Pick<Floor, 'walls' | 'doors' | 'windows'>, wall: Wall, face: 'top' | 'side', sign: 1 | -1, distance: number): PushPullResult<Map<string, Partial<Wall>>> {
  if (face === 'top') {
    const startHeight = getWallStartHeight(wall) + distance, endHeight = getWallEndHeight(wall) + distance;
    const low = Math.min(startHeight, endHeight);
    if (low < WALL_PUSH_LIMITS.minHeight || low <= wallOpeningTop(floor, wall.id)) return fail(low < WALL_PUSH_LIMITS.minHeight ? 'tooSmall' : 'belowOpening');
    if (Math.max(startHeight, endHeight) > WALL_PUSH_LIMITS.maxHeight) return fail('tooLarge');
    return { ok: true, value: new Map([[wall.id, { height: Math.max(startHeight, endHeight), startHeight, endHeight }]]) };
  }
  if (wall.curvePoint) return fail('curvedWall');
  const thickness = wall.thickness + distance;
  if (thickness < WALL_PUSH_LIMITS.minThickness) return fail('tooSmall');
  if (thickness > WALL_PUSH_LIMITS.maxThickness) return fail('tooLarge');
  const side = wallSideNormal(wall);
  // The centreline moves half the distance, which leaves the opposite face fixed.
  const shift = { x: (side.x * sign * distance) / 2, y: (side.y * sign * distance) / 2 };
  const moved = (p: Point) => ({ x: p.x + shift.x, y: p.y + shift.y });
  const joined = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= JOIN_TOLERANCE;
  const updates = new Map<string, Partial<Wall>>([[wall.id, { thickness, start: moved(wall.start), end: moved(wall.end) }]]);
  for (const other of floor.walls) {
    if (other.id === wall.id) continue;
    const update: Partial<Wall> = {};
    for (const key of ['start', 'end'] as const) {
      if (joined(other[key], wall.start) || joined(other[key], wall.end)) update[key] = moved(other[key]);
    }
    if (Object.keys(update).length) updates.set(other.id, update);
  }
  return { ok: true, value: updates };
}

function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const turn = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const p of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** Plan outline. Exact for shapes extruded vertically; the convex outline for anything tilted or wall-mounted. */
export function solidFootprint(solid: Solid): Point[] {
  const flat = (v: SolidVector) => ({ x: v.x, y: v.z });
  if (Math.abs(solidNormal(solid).y) > 0.99) return solid.profile.map(p => flat(solidPoint(solid, p, 0)));
  return convexHull(solid.profile.flatMap(p => [flat(solidPoint(solid, p, 0)), flat(solidPoint(solid, p, solid.depth))]));
}

export function findSolidAt(point: Point, solids: Solid[] | undefined): Solid | null {
  for (const solid of [...(solids ?? [])].reverse()) {
    if (!validSolid(solid)) continue;
    const outline = solidFootprint(solid);
    let inside = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const a = outline[i], b = outline[j];
      if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    if (inside) return solid;
  }
  return null;
}
