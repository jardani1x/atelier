import type { Floor, Point, Wall } from '$lib/models/types';
import { getCatalogItem, getFurnitureSize } from '$lib/utils/furnitureCatalog';
import { solidNormal } from '$lib/utils/solids';

/** A plan-space rectangle with rounded corners. Round columns have zero half-sizes. */
export interface WalkObstacle {
  x: number;
  y: number;
  halfWidth: number;
  halfDepth: number;
  cos: number;
  sin: number;
  round: number;
}

export interface WalkObstacleOptions {
  eyeHeight: number;
  /** Anything entirely below this height, in cm, can be stepped over. */
  stepHeight?: number;
}

export const WALK_BODY_RADIUS = 20;
const DEFAULT_STEP_HEIGHT = 30;
const CURVE_SEGMENTS = 24;
const RESOLVE_PASSES = 4;
/** Fittings mounted above head height or flat on a wall, which a person does not walk into. */
const OVERHEAD_FITTINGS = new Set(['ceiling_light', 'chandelier', 'pendant_light', 'wall_sconce', 'wall_sconce_outdoor']);

function segmentObstacle(a: Point, b: Point, thickness: number): WalkObstacle | null {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  return {
    x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
    halfWidth: length / 2, halfDepth: thickness / 2,
    cos: dx / length, sin: dy / length, round: 0,
  };
}

function wallPoint(wall: Wall, t: number): Point {
  const { start, end, curvePoint } = wall;
  if (!curvePoint) return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
  const u = 1 - t;
  return {
    x: u * u * start.x + 2 * u * t * curvePoint.x + t * t * end.x,
    y: u * u * start.y + 2 * u * t * curvePoint.y + t * t * end.y,
  };
}

function wallLength(wall: Wall): number {
  if (!wall.curvePoint) return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  let total = 0, previous = wall.start;
  for (let i = 1; i <= CURVE_SEGMENTS; i++) {
    const next = wallPoint(wall, i / CURVE_SEGMENTS);
    total += Math.hypot(next.x - previous.x, next.y - previous.y);
    previous = next;
  }
  return total;
}

/** Solid wall spans in curve parameter t, with every door removed. Windows stay solid. */
function solidSpans(wall: Wall, floor: Floor): [number, number][] {
  const length = wallLength(wall);
  if (length < 1e-6) return [];
  const gaps = floor.doors
    .filter(door => door.wallId === wall.id)
    .map(door => {
      const half = door.width / 2 / length;
      return [Math.max(0, door.position - half), Math.min(1, door.position + half)] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);
  const spans: [number, number][] = [];
  let cursor = 0;
  for (const [from, to] of gaps) {
    if (from > cursor) spans.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < 1) spans.push([cursor, 1]);
  return spans;
}

function pushWall(out: WalkObstacle[], wall: Wall, floor: Floor) {
  for (const [from, to] of solidSpans(wall, floor)) {
    const steps = wall.curvePoint ? Math.max(1, Math.ceil((to - from) * CURVE_SEGMENTS)) : 1;
    let previous = wallPoint(wall, from);
    for (let i = 1; i <= steps; i++) {
      const next = wallPoint(wall, from + (to - from) * i / steps);
      const obstacle = segmentObstacle(previous, next, wall.thickness);
      if (obstacle) out.push(obstacle);
      previous = next;
    }
  }
}

function rotated(x: number, y: number, width: number, depth: number, degrees: number): WalkObstacle {
  const angle = degrees * Math.PI / 180;
  return { x, y, halfWidth: width / 2, halfDepth: depth / 2, cos: Math.cos(angle), sin: Math.sin(angle), round: 0 };
}

/** Footprints a person standing on this floor would hit. Rebuild when the floor or eye height changes. */
export function buildWalkObstacles(floor: Floor, options: WalkObstacleOptions): WalkObstacle[] {
  const step = options.stepHeight ?? DEFAULT_STEP_HEIGHT;
  const top = options.eyeHeight;
  const blocks = (bottom: number, height: number) => bottom + height > step && bottom < top;
  const out: WalkObstacle[] = [];

  for (const wall of floor.walls) {
    if (blocks(0, Math.max(wall.height, wall.startHeight ?? 0, wall.endHeight ?? 0))) pushWall(out, wall, floor);
  }
  for (const cabinet of floor.cabinets ?? []) {
    if (blocks(cabinet.elevation ?? 0, cabinet.height)) {
      out.push(rotated(cabinet.position.x, cabinet.position.y, cabinet.width, cabinet.depth, cabinet.rotation));
    }
  }
  for (const item of floor.furniture) {
    if (getCatalogItem(item.catalogId)?.symbol || OVERHEAD_FITTINGS.has(item.catalogId)) continue;
    const size = getFurnitureSize(item);
    if (blocks(0, size.height)) out.push(rotated(item.position.x, item.position.y, size.width, size.depth, item.rotation));
  }
  for (const column of floor.columns) {
    if (!blocks(0, column.height)) continue;
    if (column.shape === 'round') {
      out.push({ x: column.position.x, y: column.position.y, halfWidth: 0, halfDepth: 0, cos: 1, sin: 0, round: column.diameter / 2 });
    } else {
      out.push(rotated(column.position.x, column.position.y, column.diameter, column.diameter, column.rotation));
    }
  }
  for (const solid of floor.solids ?? []) {
    const normal = solidNormal(solid);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const point of solid.profile) {
      for (const depth of [0, solid.depth]) {
        const x = solid.origin.x + solid.u.x * point.x + solid.v.x * point.y + normal.x * depth;
        const y = solid.origin.y + solid.u.y * point.x + solid.v.y * point.y + normal.y * depth;
        const z = solid.origin.z + solid.u.z * point.x + solid.v.z * point.y + normal.z * depth;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
    }
    if (blocks(minY, maxY - minY)) {
      out.push({ x: (minX + maxX) / 2, y: (minZ + maxZ) / 2, halfWidth: (maxX - minX) / 2, halfDepth: (maxZ - minZ) / 2, cos: 1, sin: 0, round: 0 });
    }
  }
  return out;
}

/** Pushes a circular body out of every obstacle. Movement along a surface survives, so walls slide. */
export function resolveWalkCollision(x: number, y: number, obstacles: readonly WalkObstacle[], radius = WALK_BODY_RADIUS): { x: number; y: number } {
  for (let pass = 0; pass < RESOLVE_PASSES; pass++) {
    let moved = false;
    for (const o of obstacles) {
      const dx = x - o.x, dy = y - o.y;
      let localX = dx * o.cos + dy * o.sin;
      let localY = -dx * o.sin + dy * o.cos;
      const edgeX = localX - Math.max(-o.halfWidth, Math.min(o.halfWidth, localX));
      const edgeY = localY - Math.max(-o.halfDepth, Math.min(o.halfDepth, localY));
      const distance = Math.hypot(edgeX, edgeY);
      const clearance = radius + o.round;
      if (distance >= clearance) continue;
      if (distance > 1e-9) {
        const push = (clearance - distance) / distance;
        localX += edgeX * push;
        localY += edgeY * push;
      } else if (o.halfWidth - Math.abs(localX) <= o.halfDepth - Math.abs(localY)) {
        localX = (localX < 0 ? -1 : 1) * (o.halfWidth + clearance);
      } else {
        localY = (localY < 0 ? -1 : 1) * (o.halfDepth + clearance);
      }
      x = o.x + localX * o.cos - localY * o.sin;
      y = o.y + localX * o.sin + localY * o.cos;
      moved = true;
    }
    if (!moved) break;
  }
  return { x, y };
}
