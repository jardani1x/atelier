import type { Cabinet, Point, Solid } from '$lib/models/types';
import { cabinetBounds, cabinetPanels, type CabinetPanel } from './cabinetGeometry';
import { solidFootprint, validSolid } from './solids';

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function boundsOf(points: Point[]): Bounds {
  return { minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)),
    maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)) };
}

/** Plan corners of a rectangle given in the cabinet's local plan axes (x along the width, y towards the front). */
function cabinetLocalRect(cabinet: Cabinet, minX: number, minY: number, maxX: number, maxY: number): Point[] {
  const angle = cabinet.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]].map(([x, y]) => ({
    x: cabinet.position.x + x * c - y * s,
    y: cabinet.position.y + x * s + y * c,
  }));
}

/** The outline the plan view draws, including doors that stand proud of the carcass. */
export function cabinetPlanCorners(cabinet: Cabinet): Point[] {
  const { min, max } = cabinetBounds(cabinetPanels(cabinet));
  return cabinetLocalRect(cabinet, min.x, min.z, max.x, max.z);
}

/** Plan corners of one panel, for exporters that cannot reuse the canvas drawing. */
export function cabinetPanelPlanCorners(cabinet: Cabinet, panel: CabinetPanel): Point[] {
  return cabinetLocalRect(cabinet, panel.center.x - panel.size.x / 2, panel.center.z - panel.size.z / 2,
    panel.center.x + panel.size.x / 2, panel.center.z + panel.size.z / 2);
}

export function cabinetPlanBounds(cabinet: Cabinet): Bounds {
  return boundsOf(cabinetPlanCorners(cabinet));
}

/** Null for a solid the plan view does not draw. */
export function solidPlanBounds(solid: Solid): Bounds | null {
  if (!validSolid(solid)) return null;
  const outline = solidFootprint(solid);
  return outline.length ? boundsOf(outline) : null;
}

/** Centre of the drawn footprint; solids have no single plan position of their own. */
export function solidPlanCenter(solid: Solid): Point | null {
  const b = solidPlanBounds(solid);
  return b && { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}
