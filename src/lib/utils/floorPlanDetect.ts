import type { Door, Point, Wall, Window } from '$lib/models/types';

/**
 * Finds straight horizontal and vertical walls in a floor plan image, then reads the gaps between
 * collinear walls, and between a wall end and the wall it faces, as doors and windows. Walls are
 * found one thickness class at a time, so thin partitions survive next to thick structural walls.
 * Everything here works in image pixels until draftToElements converts the reviewed result to
 * plan centimetres.
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
/** A glazing line runs the length of the gap; a door leaf or swing arc only crosses it. */
const GLAZING_RUN = 0.8;
/** Share of a quarter circle about a jamb that must be drawn before it counts as a door swing. */
const SWING_ARC = 0.8;
/** Luma step that separates a thin drawn line from the floor fill on both sides of it. */
const LINE_CONTRAST = 20;
/** Structural walls, partitions, and one finer class; each class is thinner than the last. */
const MAX_THICKNESS_CLASSES = 3;
const NEXT_CLASS_RATIO = 0.6;
/** Drawn door swings needed before the plan is trusted to draw one on every door. */
const SWINGS_FOR_PASSAGES = 2;

type Mask = Uint8Array;
interface Line { pos: number; a: number; b: number; thickness: number; gaps: Gap[]; linked: boolean }
/** A blank gap has no swing or glazing drawn in it: a door on a plan that draws none, otherwise an open passage. */
interface Gap { from: number; to: number; kind: 'door' | 'window' | 'blank' }

function inkMask({ width, height, data }: PlanRaster): { ink: Mask; gray: Uint8Array } {
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
  return { ink: mask, gray };
}

/**
 * Ink plus thin lines too pale for the ink threshold, such as grey glazing lines and door swings
 * drawn over a tinted floor. A pixel counts when it is darker than both neighbours a few pixels
 * away on one axis, which a shadow or a change of floor colour is not.
 */
function drawnMask(gray: Uint8Array, ink: Mask, width: number, height: number, reach: number): Mask {
  const out = Uint8Array.from(ink);
  const offsets = [...new Set([2, 4, Math.max(2, Math.ceil(reach))])];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (out[i]) continue;
    const level = gray[i] + LINE_CONTRAST;
    for (const d of offsets) {
      if ((x >= d && x + d < width && gray[i - d] >= level && gray[i + d] >= level)
        || (y >= d && y + d < height && gray[i - d * width] >= level && gray[i + d * width] >= level)) { out[i] = 1; break; }
    }
  }
  return out;
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

/** The most common stroke width between the given bounds, or 0 when there is none. */
function wallThickness(mask: Mask, width: number, height: number, low: number, high: number): number {
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

/** True when one row of the wall band is drawn along nearly the whole gap, as glazing is. */
function glazingRun(drawn: Mask, width: number, height: number, line: Line, from: number, to: number): boolean {
  const inset = (to - from) * 0.1;
  const first = Math.ceil(from + inset), last = Math.floor(to - inset);
  if (last <= first) return false;
  const half = Math.max(2, line.thickness / 2);
  for (let y = Math.max(1, Math.floor(line.pos - half)); y <= Math.min(height - 2, Math.ceil(line.pos + half)); y++) {
    let hits = 0;
    // A scanned line wanders by a pixel, so the rows either side count too.
    for (let x = Math.max(0, first); x < Math.min(width, last); x++) {
      if (drawn[y * width + x] || drawn[(y - 1) * width + x] || drawn[(y + 1) * width + x]) hits++;
    }
    if (hits >= GLAZING_RUN * (last - first)) return true;
  }
  return false;
}

/** True when a quarter circle is drawn about either jamb, which only a door swing does. */
function swingArc(drawn: Mask, width: number, height: number, pos: number, from: number, to: number): boolean {
  const gap = to - from;
  const near = (x: number, y: number) => {
    const cx = Math.round(x), cy = Math.round(y);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const px = cx + dx, py = cy + dy;
      if (px >= 0 && py >= 0 && px < width && py < height && drawn[py * width + px]) return true;
    }
    return false;
  };
  const angles: [number, number][] = [];
  // The ends of the arc meet the wall and the leaf, which would count for any gap.
  for (let degrees = 15; degrees <= 75; degrees += 3) angles.push([Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180)]);
  // A leaf can be narrower than the gap: the smaller leaf of an unequal pair, or a door in a wide frame.
  for (let radius = Math.max(4, gap * 0.45); radius <= gap * 1.08; radius++) {
    for (const [hinge, along] of [[from, 1], [to, -1]]) for (const side of [-1, 1]) {
      let hits = 0;
      for (const [c, s] of angles) if (near(hinge + along * radius * c, pos + side * radius * s)) hits++;
      if (hits >= SWING_ARC * angles.length) return true;
    }
  }
  return false;
}

/** What a gap in a wall line is. A blank gap only counts between two pieces of the same wall. */
function gapKind(ink: Mask, drawn: Mask, width: number, height: number, line: Line, from: number, to: number, cmPerPixel: number, collinear: boolean): Gap['kind'] | null {
  const gapCm = (to - from) * cmPerPixel;
  const doorSized = gapCm >= DOOR_CM[0] && gapCm <= DOOR_CM[1];
  if (doorSized && swingArc(drawn, width, height, line.pos, from, to)) return 'door';
  // Scattered ink only counts inside a wall; past a wall end it is as likely a room label.
  const glazed = (collinear && gapInk(ink, width, line, from, to, height) >= WINDOW_INK) || glazingRun(drawn, width, height, line, from, to);
  if (glazed) return gapCm >= WINDOW_CM[0] && gapCm <= WINDOW_CM[1] ? 'window' : null;
  return collinear && doorSized ? 'blank' : null;
}

/** Joins collinear walls across gaps that read as doors or windows. */
function joinOpenings(lines: Line[], crossing: Line[], ink: Mask, drawn: Mask, width: number, height: number, cmPerPixel: number): Line[] {
  const sorted = [...lines].sort((p, q) => p.pos - q.pos || p.a - q.a);
  const groups: Line[][] = [];
  for (const line of sorted) {
    const group = groups.find(g => Math.abs(g[0].pos - line.pos) <= Math.max(g[0].thickness, line.thickness) / 2);
    if (group) group.push(line); else groups.push([line]);
  }
  const joined: Line[] = [];
  for (const group of groups) {
    group.sort((p, q) => p.a - q.a);
    // Copies, so that later changes to a joined wall leave the raw lines as they were found.
    let current: Line = { ...group[0], gaps: [...group[0].gaps] };
    for (const line of group.slice(1)) {
      const gap = line.a - current.b;
      const blockers = crossing.filter(c => c.pos > current.b + 1 && c.pos < line.a - 1 && line.pos >= c.a && line.pos <= c.b);
      // A wall that only pauses for the wall crossing it is one wall.
      const solid = gap <= 1.5 * Math.max(current.thickness, line.thickness, ...blockers.map(c => c.thickness));
      const kind = solid ? 'solid' : blockers.length ? null
        : gapKind(ink, drawn, width, height, current, current.b, line.a, cmPerPixel, true);
      if (kind === null) { joined.push(current); current = { ...line, gaps: [...line.gaps] }; continue; }
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

/**
 * Settles the blank gaps. On a plan that draws door swings a blank gap is an open passage, so the
 * wall is split there; on any other plan it is the only sign of a door.
 */
function settleBlanks(lines: Line[], passages: boolean): Line[] {
  return lines.flatMap(line => {
    if (!passages) return [{ ...line, gaps: line.gaps.map(gap => ({ ...gap, kind: gap.kind === 'window' ? 'window' as const : 'door' as const })) }];
    const pieces: Line[] = [];
    let a = line.a;
    for (const cut of [...line.gaps.filter(gap => gap.kind === 'blank').sort((p, q) => p.from - q.from), null]) {
      const b = cut ? cut.from : line.b;
      pieces.push({ ...line, a, b, gaps: line.gaps.filter(gap => gap.kind !== 'blank' && gap.from >= a && gap.to <= b) });
      if (cut) a = cut.to;
    }
    return pieces;
  });
}

/**
 * Carries a wall on to the wall it faces when the space between holds a door swing or glazing:
 * a door hung in a corner, or a window that fills the wall up to the return.
 */
function openToCrossing(lines: Line[], crossing: Line[], ink: Mask, drawn: Mask, width: number, height: number, cmPerPixel: number) {
  for (const line of lines) for (const end of ['a', 'b'] as const) {
    const along = end === 'a' ? -1 : 1;
    const tip = line[end];
    let face = 0, distance = Infinity, facing: Line | null = null;
    for (const other of crossing) {
      if (line.pos < other.a - other.thickness || line.pos > other.b + other.thickness) continue;
      const nearFace = other.pos - along * other.thickness / 2;
      const away = (nearFace - tip) * along;
      if (away > 0 && away < distance) { facing = other; face = nearFace; distance = away; }
    }
    // Shorter distances are an ordinary corner, which snapEnds closes.
    if (!facing || distance <= 1.5 * Math.max(line.thickness, facing.thickness)) continue;
    const from = Math.min(tip, face), to = Math.max(tip, face);
    const inTheWay = lines.some(other => other !== line && other.b > from && other.a < to
      && Math.abs(other.pos - line.pos) <= (other.thickness + line.thickness) / 2);
    if (inTheWay) continue;
    const kind = gapKind(ink, drawn, width, height, line, from, to, cmPerPixel, false);
    if (!kind) continue;
    line[end] = face;
    line.gaps.push({ from, to, kind });
  }
}

/** Moves wall ends onto the centre line of the wall they meet, so corners share exact points. */
function snapEnds(lines: Line[], crossing: Line[]) {
  const originals = lines.map(line => ({ a: line.a, b: line.b }));
  lines.forEach((line, index) => {
    for (const key of ['a', 'b'] as const) {
      let nearest: Line | null = null, distance = Infinity;
      for (const other of crossing) {
        const reach = Math.max(other.thickness, line.thickness) * 1.2;
        const gap = Math.abs(other.pos - originals[index][key]);
        if (gap <= reach && gap < distance && line.pos >= other.a - reach && line.pos <= other.b + reach) { nearest = other; distance = gap; }
      }
      if (nearest) { line[key] = nearest.pos; line.linked = true; nearest.linked = true; }
    }
  });
}

function extract(working: Mask, ink: Mask, drawn: Mask, width: number, height: number, cmPerPixel: number): PlanDraft {
  const none: PlanDraft = { walls: [], openings: [], coverage: 0 };
  const low = Math.max(2, MIN_WALL_CM / cmPerPixel);
  const thickest = wallThickness(working, width, height, low, MAX_WALL_CM / cmPerPixel);
  if (!thickest) return none;
  const rawHorizontal: Line[] = [], rawVertical: Line[] = [];
  let opened: Mask = working, residual = working;
  for (let pass = 0, thickness = thickest; pass < MAX_THICKNESS_CLASSES && thickness; pass++) {
    const radius = Math.max(1, Math.floor(thickness * 0.2));
    const cleaned = dilate(erode(residual, width, height, radius), width, height, radius);
    if (pass === 0) opened = cleaned;
    const minLength = Math.max(2 * thickness + 1, MIN_LENGTH_CM / cmPerPixel);
    const found = [
      bands(cleaned, width, height, minLength, thickness),
      bands(transpose(cleaned, width, height), height, width, minLength, thickness),
    ];
    rawHorizontal.push(...found[0]); rawVertical.push(...found[1]);
    // Walls already found are rubbed out, so the next class is read from what is left.
    residual = Uint8Array.from(residual);
    found.forEach((lines, vertical) => {
      for (const line of lines) {
        const half = line.thickness / 2 + 2;
        for (let across = Math.max(0, Math.floor(line.pos - half)); across < Math.min(vertical ? width : height, line.pos + half); across++) {
          for (let along = Math.max(0, line.a - 2); along < Math.min(vertical ? height : width, line.b + 2); along++) {
            residual[vertical ? along * width + across : across * width + along] = 0;
          }
        }
      }
    });
    const high = thickness * NEXT_CLASS_RATIO;
    thickness = high >= low ? wallThickness(residual, width, height, low, high) : 0;
  }
  const flippedInk = transpose(ink, width, height);
  const flippedDrawn = transpose(drawn, width, height);
  let horizontal = joinOpenings(rawHorizontal, rawVertical, ink, drawn, width, height, cmPerPixel);
  let vertical = joinOpenings(rawVertical, rawHorizontal, flippedInk, flippedDrawn, height, width, cmPerPixel);
  openToCrossing(horizontal, rawVertical, ink, drawn, width, height, cmPerPixel);
  openToCrossing(vertical, rawHorizontal, flippedInk, flippedDrawn, height, width, cmPerPixel);
  const swings = [...horizontal, ...vertical].flatMap(line => line.gaps).filter(gap => gap.kind === 'door').length;
  horizontal = settleBlanks(horizontal, swings >= SWINGS_FOR_PASSAGES);
  vertical = settleBlanks(vertical, swings >= SWINGS_FOR_PASSAGES);
  // Each axis snaps against the other's unsnapped ranges plus reach, so order does not matter.
  snapEnds(horizontal, vertical);
  snapEnds(vertical, horizontal);

  const keep = (line: Line) => line.b > line.a && (line.linked || (line.b - line.a) * cmPerPixel >= ISOLATED_LENGTH_CM);
  const walls: DraftWall[] = [];
  const openings: DraftOpening[] = [];
  const covered = new Uint8Array(opened.length);
  const add = (line: Line, isHorizontal: boolean) => {
    const point = (along: number): Point => isHorizontal ? { x: along, y: line.pos } : { x: line.pos, y: along };
    const wall = walls.push({ start: point(line.a), end: point(line.b), thickness: line.thickness }) - 1;
    for (const gap of line.gaps) {
      openings.push({ wall, kind: gap.kind === 'window' ? 'window' : 'door', center: ((gap.from + gap.to) / 2 - line.a) / (line.b - line.a), width: gap.to - gap.from });
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
  const { ink, gray } = inkMask(raster);
  const drawn = drawnMask(gray, ink, width, height, MIN_WALL_CM / cmPerPixel / 2);
  const solid = extract(ink, ink, drawn, width, height, cmPerPixel);
  if (solid.walls.length >= 4) return solid;
  // Plans drawn with outlined walls have no solid band until the two faces are closed together.
  const radius = Math.max(1, Math.round(MAX_HOLLOW_WALL_CM / cmPerPixel / 2));
  const closed = erode(dilate(ink, width, height, radius), width, height, radius);
  const hollow = extract(closed, ink, drawn, width, height, cmPerPixel);
  return hollow.walls.length > solid.walls.length ? hollow : solid;
}

/** Longest side of a typical dwelling, used as the first scale guess before any door is measured. */
const TYPICAL_PLAN_CM = 1200;
const TYPICAL_DOOR_CM = 85;

/**
 * Detects a plan with no calibration. The scale is first guessed from the size of the drawing,
 * then corrected so the median door is a standard door width. The result is an estimate that the
 * user can replace with a measured scale.
 */
export function autoDetectFloorPlan(raster: PlanRaster): { draft: PlanDraft; cmPerPixel: number } | null {
  const { width, height } = raster;
  const { ink } = inkMask(raster);
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!ink[y * width + x]) continue;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  const span = Math.max(right - left, bottom - top) + 1;
  if (right < 0 || span < 50) return null;
  let cmPerPixel = TYPICAL_PLAN_CM / span;
  let draft = detectFloorPlan(raster, cmPerPixel);
  const doors = draft.openings.filter(o => o.kind === 'door').map(o => o.width).sort((a, b) => a - b);
  if (doors.length) {
    const median = doors[Math.floor((doors.length - 1) / 2)];
    const refined = Math.min(cmPerPixel * 2, Math.max(cmPerPixel / 2, TYPICAL_DOOR_CM / median));
    if (Math.abs(refined / cmPerPixel - 1) > 0.1) {
      const again = detectFloorPlan(raster, refined);
      if (again.walls.length) { draft = again; cmPerPixel = refined; }
    }
  }
  return draft.walls.length ? { draft, cmPerPixel } : null;
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
