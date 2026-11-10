import type { Door, Point, Wall, Window } from '$lib/models/types';

/**
 * Finds straight horizontal and vertical walls in a floor plan image, then reads the gaps between
 * collinear walls as doors and windows. Everything here works in image pixels until
 * draftToElements converts the reviewed result to plan centimetres.
 */
export interface PlanRaster { width: number; height: number; data: Uint8ClampedArray }
export interface DraftWall { start: Point; end: Point; thickness: number }
export interface DraftOpening { wall: number; kind: 'door' | 'window'; center: number; width: number }
export interface PlanDraft {
  walls: DraftWall[];
  openings: DraftOpening[];
  /** Share of the detected wall ink explained by the draft; low values mean angled or curved walls. */
  coverage: number;
}

const MIN_WALL_CM = 5;
const MAX_WALL_CM = 60;
const MIN_LENGTH_CM = 40;
const ISOLATED_LENGTH_CM = 100;
const MAX_HOLLOW_WALL_CM = 40;
const DOOR_CM = [55, 300] as const;
const WINDOW_CM = [40, 500] as const;
/** Glazing lines usually fill this share of a window gap; a door gap is nearly blank. */
const WINDOW_INK = 0.12;

type Mask = Uint8Array;
interface Line { pos: number; a: number; b: number; thickness: number; gaps: Gap[]; linked: boolean }
interface Gap { from: number; to: number; kind: 'door' | 'window' }

function inkMask({ width, height, data }: PlanRaster): Mask {
  const gray = new Uint8Array(width * height);
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) {
    const alpha = data[i * 4 + 3] / 255;
    const luma = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    gray[i] = Math.round(luma * alpha + 255 * (1 - alpha));
    histogram[gray[i]]++;
  }
  // Otsu threshold: the cut that best separates paper from ink.
  let sum = 0;
  histogram.forEach((count, value) => { sum += value * count; });
  let backSum = 0, back = 0, best = -1, threshold = -1;
  for (let value = 0; value < 255; value++) {
    back += histogram[value];
    if (!back) continue;
    const fore = gray.length - back;
    if (!fore) break;
    backSum += value * histogram[value];
    const between = back * fore * (backSum / back - (sum - backSum) / fore) ** 2;
    if (between > best) { best = between; threshold = value; }
  }
  const mask = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) mask[i] = gray[i] <= threshold ? 1 : 0;
  return mask;
}

function dilateAxis(source: Mask, width: number, height: number, radius: number, horizontal: boolean): Mask {
  const out = new Uint8Array(source.length);
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const step = horizontal ? 1 : width;
  for (let line = 0; line < lines; line++) {
    const origin = horizontal ? line * width : line;
    let count = 0;
    for (let i = 0; i < Math.min(radius, length); i++) count += source[origin + i * step];
    for (let i = 0; i < length; i++) {
      if (i + radius < length) count += source[origin + (i + radius) * step];
      if (count > 0) out[origin + i * step] = 1;
      if (i - radius >= 0) count -= source[origin + (i - radius) * step];
    }
  }
  return out;
}

const dilate = (mask: Mask, width: number, height: number, radius: number) =>
  dilateAxis(dilateAxis(mask, width, height, radius, true), width, height, radius, false);
const invert = (mask: Mask) => mask.map(value => 1 - value);
const erode = (mask: Mask, width: number, height: number, radius: number) =>
  invert(dilate(invert(mask), width, height, radius));

function transpose(mask: Mask, width: number, height: number): Mask {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[x * height + y] = mask[y * width + x];
  return out;
}

/** The most common stroke width that is plausible for a real wall at this scale. */
function wallThickness(mask: Mask, width: number, height: number, cmPerPixel: number): number {
  const horizontal = new Uint16Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width;) {
    if (!mask[y * width + x]) { x++; continue; }
    let end = x;
    while (end < width && mask[y * width + end]) end++;
    for (let i = x; i < end; i++) horizontal[y * width + i] = end - x;
    x = end;
  }
  const histogram = new Map<number, number>();
  for (let x = 0; x < width; x++) for (let y = 0; y < height;) {
    if (!mask[y * width + x]) { y++; continue; }
    let end = y;
    while (end < height && mask[end * width + x]) end++;
    for (let i = y; i < end; i++) {
      const stroke = Math.min(horizontal[i * width + x], end - y);
      histogram.set(stroke, (histogram.get(stroke) ?? 0) + 1);
    }
    y = end;
  }
  const low = Math.max(2, MIN_WALL_CM / cmPerPixel);
  const high = MAX_WALL_CM / cmPerPixel;
  let thickness = 0, most = 0;
  for (const [stroke, count] of histogram) {
    if (stroke >= low && stroke <= high && count > most) { most = count; thickness = stroke; }
  }
  return thickness;
}

/** Stacks long horizontal runs of ink into wall bands. */
function bands(mask: Mask, width: number, height: number, minLength: number, thickness: number): Line[] {
  type Band = { x0: number; x1: number; y0: number; y1: number; last0: number; last1: number };
  let active: Band[] = [];
  const done: Band[] = [];
  for (let y = 0; y < height; y++) {
    const next: Band[] = [];
    for (let x = 0; x < width;) {
      if (!mask[y * width + x]) { x++; continue; }
      let end = x;
      while (end < width && mask[y * width + end]) end++;
      const last = end - 1;
      if (end - x >= minLength) {
        const match = active.find(band => {
          const overlap = Math.min(band.last1, last) - Math.max(band.last0, x) + 1;
          return !next.includes(band) && overlap >= 0.7 * Math.max(band.last1 - band.last0 + 1, end - x);
        });
        if (match) {
          match.x0 = Math.min(match.x0, x); match.x1 = Math.max(match.x1, last);
          match.y1 = y; match.last0 = x; match.last1 = last;
          next.push(match);
        } else next.push({ x0: x, x1: last, y0: y, y1: y, last0: x, last1: last });
      }
      x = end;
    }
    done.push(...active.filter(band => !next.includes(band)));
    active = next;
  }
  done.push(...active);
  return done
    .map(band => ({ pos: (band.y0 + band.y1 + 1) / 2, a: band.x0, b: band.x1 + 1, thickness: band.y1 - band.y0 + 1, gaps: [], linked: false }))
    .filter(line => line.thickness >= thickness * 0.35 && line.thickness <= thickness * 2.5);
}

function gapInk(ink: Mask, width: number, line: Line, from: number, to: number, height: number): number {
  const inset = (to - from) * 0.2;
  const halfBand = Math.max(1, line.thickness / 2);
  let hits = 0, total = 0;
  for (let x = Math.ceil(from + inset); x < to - inset; x++) {
    for (let y = Math.floor(line.pos - halfBand); y < line.pos + halfBand; y++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      total++;
      hits += ink[y * width + x];
    }
  }
  return total ? hits / total : 0;
}

/** Joins collinear walls across gaps that read as doors or windows. */
function joinOpenings(lines: Line[], crossing: Line[], ink: Mask, width: number, height: number, thickness: number, cmPerPixel: number): Line[] {
  const sorted = [...lines].sort((p, q) => p.pos - q.pos || p.a - q.a);
  const groups: Line[][] = [];
  for (const line of sorted) {
    const group = groups.find(g => Math.abs(g[0].pos - line.pos) <= Math.max(g[0].thickness, line.thickness) / 2);
    if (group) group.push(line); else groups.push([line]);
  }
  const joined: Line[] = [];
  for (const group of groups) {
    group.sort((p, q) => p.a - q.a);
    let current = group[0];
    for (const line of group.slice(1)) {
      const gap = line.a - current.b;
      const blocked = crossing.some(c => c.pos > current.b + 1 && c.pos < line.a - 1 && line.pos >= c.a && line.pos <= c.b);
      const gapCm = gap * cmPerPixel;
      let kind: Gap['kind'] | 'solid' | null = null;
      if (gap <= thickness * 1.5) kind = 'solid';
      else if (!blocked) {
        const filled = gapInk(ink, width, current, current.b, line.a, height) >= WINDOW_INK;
        if (filled && gapCm >= WINDOW_CM[0] && gapCm <= WINDOW_CM[1]) kind = 'window';
        else if (!filled && gapCm >= DOOR_CM[0] && gapCm <= DOOR_CM[1]) kind = 'door';
      }
      if (kind === null) { joined.push(current); current = line; continue; }
      const gaps = kind === 'solid' ? [] : [{ from: current.b, to: line.a, kind }];
      const lengthA = current.b - current.a, lengthB = line.b - line.a;
      current = {
        pos: (current.pos * lengthA + line.pos * lengthB) / (lengthA + lengthB),
        a: current.a, b: Math.max(current.b, line.b), thickness: Math.max(current.thickness, line.thickness),
        gaps: [...current.gaps, ...gaps, ...line.gaps], linked: false,
      };
    }
    joined.push(current);
  }
  return joined;
}

/** Moves wall ends onto the centre line of the wall they meet, so corners share exact points. */
function snapEnds(lines: Line[], crossing: Line[], thickness: number) {
  const originals = lines.map(line => ({ a: line.a, b: line.b }));
  lines.forEach((line, index) => {
    for (const key of ['a', 'b'] as const) {
      let nearest: Line | null = null, distance = Infinity;
      for (const other of crossing) {
        const reach = Math.max(thickness * 1.2, other.thickness, line.thickness);
        const gap = Math.abs(other.pos - originals[index][key]);
        if (gap <= reach && gap < distance && line.pos >= other.a - reach && line.pos <= other.b + reach) { nearest = other; distance = gap; }
      }
      if (nearest) { line[key] = nearest.pos; line.linked = true; nearest.linked = true; }
    }
  });
}

function extract(working: Mask, ink: Mask, width: number, height: number, cmPerPixel: number): PlanDraft {
  const none: PlanDraft = { walls: [], openings: [], coverage: 0 };
  const thickness = wallThickness(working, width, height, cmPerPixel);
  if (!thickness) return none;
  const radius = Math.max(1, Math.floor(thickness * 0.2));
  const opened = dilate(erode(working, width, height, radius), width, height, radius);
  const minLength = Math.max(2 * thickness + 1, MIN_LENGTH_CM / cmPerPixel);
  const flipped = transpose(opened, width, height);
  const flippedInk = transpose(ink, width, height);
  const rawHorizontal = bands(opened, width, height, minLength, thickness);
  const rawVertical = bands(flipped, height, width, minLength, thickness);
  const horizontal = joinOpenings(rawHorizontal, rawVertical, ink, width, height, thickness, cmPerPixel);
  const vertical = joinOpenings(rawVertical, rawHorizontal, flippedInk, height, width, thickness, cmPerPixel);
  // Each axis snaps against the other's unsnapped ranges plus reach, so order does not matter.
  snapEnds(horizontal, vertical, thickness);
  snapEnds(vertical, horizontal, thickness);

  const keep = (line: Line) => line.b > line.a && (line.linked || (line.b - line.a) * cmPerPixel >= ISOLATED_LENGTH_CM);
  const walls: DraftWall[] = [];
  const openings: DraftOpening[] = [];
  const covered = new Uint8Array(opened.length);
  const add = (line: Line, isHorizontal: boolean) => {
    const point = (along: number): Point => isHorizontal ? { x: along, y: line.pos } : { x: line.pos, y: along };
    const wall = walls.push({ start: point(line.a), end: point(line.b), thickness: line.thickness }) - 1;
    for (const gap of line.gaps) {
      openings.push({ wall, kind: gap.kind, center: ((gap.from + gap.to) / 2 - line.a) / (line.b - line.a), width: gap.to - gap.from });
    }
    const half = line.thickness / 2 + 1;
    for (let along = Math.floor(line.a - half); along < line.b + half; along++) {
      for (let across = Math.floor(line.pos - half); across < line.pos + half; across++) {
        const x = isHorizontal ? along : across, y = isHorizontal ? across : along;
        if (x >= 0 && y >= 0 && x < width && y < height) covered[y * width + x] = 1;
      }
    }
  };
  horizontal.filter(keep).forEach(line => add(line, true));
  vertical.filter(keep).forEach(line => add(line, false));

  let wallInk = 0, explained = 0;
  for (let i = 0; i < opened.length; i++) {
    if (!opened[i]) continue;
    wallInk++;
    explained += covered[i];
  }
  return { walls, openings, coverage: wallInk ? explained / wallInk : 0 };
}

export function detectFloorPlan(raster: PlanRaster, cmPerPixel: number): PlanDraft {
  const { width, height } = raster;
  const ink = inkMask(raster);
  const solid = extract(ink, ink, width, height, cmPerPixel);
  if (solid.walls.length >= 4) return solid;
  // Plans drawn with outlined walls have no solid band until the two faces are closed together.
  const radius = Math.max(1, Math.round(MAX_HOLLOW_WALL_CM / cmPerPixel / 2));
  const closed = erode(dilate(ink, width, height, radius), width, height, radius);
  const hollow = extract(closed, ink, width, height, cmPerPixel);
  return hollow.walls.length > solid.walls.length ? hollow : solid;
}

export interface DraftElements { walls: Wall[]; doors: Door[]; windows: Window[] }

/** Converts a draft to plan elements placed exactly over an image centred at the origin. */
export function draftToElements(draft: PlanDraft, size: { width: number; height: number }, cmPerPixel: number, uid: () => string): DraftElements {
  const toPlan = (point: Point): Point => ({
    x: Math.round((point.x - size.width / 2) * cmPerPixel),
    y: Math.round((point.y - size.height / 2) * cmPerPixel),
  });
  const walls = draft.walls.map((wall): Wall => ({
    id: uid(), start: toPlan(wall.start), end: toPlan(wall.end),
    thickness: Math.min(MAX_WALL_CM, Math.max(MIN_WALL_CM, Math.round(wall.thickness * cmPerPixel))),
    height: 280, startHeight: 280, endHeight: 280, color: '#444444',
  }));
  const doors: Door[] = [];
  const windows: Window[] = [];
  for (const opening of draft.openings) {
    const wallId = walls[opening.wall].id;
    const position = Math.min(1, Math.max(0, opening.center));
    const width = Math.round(opening.width * cmPerPixel);
    if (opening.kind === 'window') windows.push({ id: uid(), wallId, position, width, height: 120, sillHeight: 90, type: 'standard' });
    else doors.push({ id: uid(), wallId, position, width, height: 210, type: width > 200 ? 'opening' : width > 130 ? 'double' : 'single', swingDirection: 'left', flipSide: false });
  }
  return { walls, doors, windows };
}

/** Real-world centimetres for each image pixel, from two clicked points and their true distance. */
export function cmPerPixelFrom(a: Point, b: Point, distanceCm: number): number | null {
  const pixels = Math.hypot(b.x - a.x, b.y - a.y);
  return pixels >= 1 && distanceCm > 0 && Number.isFinite(distanceCm) ? distanceCm / pixels : null;
}
