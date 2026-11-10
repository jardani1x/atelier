export interface PlanPoint { x: number; y: number }
export interface CeilingOutline { outline: PlanPoint[]; height: number }
export interface CeilingLightPosition { x: number; y: number; z: number }

/** Centre-to-centre spacing of generated fittings, in centimetres. */
export const CEILING_LIGHT_SPACING_CM = 200;
/** Each light is a tracer sample cost, so the whole home shares one budget. */
export const MAX_CEILING_LIGHTS = 24;
/** Fittings hang just below the ceiling plane so the surface cannot occlude them. */
export const CEILING_LIGHT_DROP_CM = 2;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Blackbody approximation (Tanner Helland's curve fit), returned as sRGB 0..1. */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = clamp(kelvin, 1000, 40000) / 100;
  const red = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const green = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp(red, 0, 255) / 255, clamp(green, 0, 255) / 255, clamp(blue, 0, 255) / 255];
}

export function pointInPolygon(point: PlanPoint, polygon: PlanPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Whether a world-space point (y up, plan y along z) sits under any ceiling. */
export function viewpointInsideRoom(point: { x: number; y: number; z: number }, ceilings: CeilingOutline[]): boolean {
  return ceilings.some((ceiling) => point.y < ceiling.height && pointInPolygon({ x: point.x, y: point.z }, ceiling.outline));
}

function polygonCentre(polygon: PlanPoint[]): PlanPoint {
  const sum = polygon.reduce((total, p) => ({ x: total.x + p.x, y: total.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / polygon.length, y: sum.y / polygon.length };
}

/** Evenly centred grid inside one room. A room too small for the grid still gets one fitting. */
export function ceilingLightPositions(outline: PlanPoint[], height: number, spacing = CEILING_LIGHT_SPACING_CM): CeilingLightPosition[] {
  if (outline.length < 3) return [];
  const xs = outline.map((p) => p.x), ys = outline.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const columns = Math.max(1, Math.floor((maxX - minX) / spacing));
  const rows = Math.max(1, Math.floor((maxY - minY) / spacing));
  const stepX = (maxX - minX) / columns, stepY = (maxY - minY) / rows;
  const z = height - CEILING_LIGHT_DROP_CM;
  const found: CeilingLightPosition[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const point = { x: minX + stepX * (column + 0.5), y: minY + stepY * (row + 0.5) };
      if (pointInPolygon(point, outline)) found.push({ x: point.x, y: height - CEILING_LIGHT_DROP_CM, z: point.y });
    }
  }
  if (found.length) return found;
  // An L-shaped or narrow room can miss every cell centre. Fall back to any interior point.
  const centre = polygonCentre(outline);
  if (pointInPolygon(centre, outline)) return [{ x: centre.x, y: z, z: centre.y }];
  const a = outline[0], b = outline[1], c = outline[2];
  const inner = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
  return [{ x: inner.x, y: z, z: inner.y }];
}

/** Lays out every room, then thins evenly to the budget so no single room loses all its light first. */
export function layoutCeilingLights(ceilings: CeilingOutline[], max = MAX_CEILING_LIGHTS): CeilingLightPosition[] {
  const all = ceilings.flatMap((ceiling) => ceilingLightPositions(ceiling.outline, ceiling.height));
  if (all.length <= max) return all;
  return Array.from({ length: max }, (_, i) => all[Math.floor((i * all.length) / max)]);
}
