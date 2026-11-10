/** Parametric cabinet panels. All lengths are centimetres, matching the plan model.
 * Local axes: x along the width, y up from the floor, z towards the cabinet front.
 * The origin is the centre of the footprint at floor level. */

export type CabinetDoorStyle = 'none' | 'hinged' | 'sliding';

export interface CabinetParams {
  width: number;
  height: number;
  depth: number;
  /** Panel thickness. */
  thickness: number;
  /** Vertical bays, at least 1. */
  compartments: number;
  /** Shelf heights as fractions (0..1) of the interior height, applied to every bay. */
  shelves: number[];
  doors: CabinetDoorStyle;
}

export type CabinetPanelRole = 'side' | 'top' | 'bottom' | 'back' | 'divider' | 'shelf' | 'door';

export interface CabinetPanel {
  role: CabinetPanelRole;
  center: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
}

export const CABINET_LIMITS = {
  minSize: 10,
  maxSize: 600,
  minThickness: 0.6,
  maxThickness: 5,
  maxCompartments: 12,
  maxShelves: 12,
} as const;

const DOOR_THICKNESS = 1.8;
const BACK_THICKNESS = 0.6;
/** Gap between sliding door tracks. */
const SLIDING_OFFSET = DOOR_THICKNESS + 0.2;

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Returns values that always produce valid solid panels, whatever was stored or typed. */
export function normalizeCabinetParams(params: CabinetParams): CabinetParams {
  const { minSize, maxSize, minThickness, maxThickness, maxCompartments, maxShelves } = CABINET_LIMITS;
  const width = clamp(params.width, minSize, maxSize, 100);
  const height = clamp(params.height, minSize, maxSize, 200);
  const depth = clamp(params.depth, minSize, maxSize, 60);
  // Two sides and the top and bottom must always leave interior space.
  const thickness = clamp(params.thickness, minThickness, Math.min(maxThickness, Math.min(width, height) / 4), 1.8);
  const widthPerBay = thickness + 1;
  const possibleBays = Math.max(1, Math.floor((width - thickness) / widthPerBay));
  const compartments = Math.min(possibleBays, maxCompartments, Math.max(1, Math.round(clamp(params.compartments, 1, maxCompartments, 1))));
  const shelves = [...new Set((params.shelves ?? []).filter(s => Number.isFinite(s) && s > 0 && s < 1))]
    .sort((a, b) => a - b)
    .slice(0, maxShelves);
  const doors: CabinetDoorStyle = params.doors === 'hinged' || params.doors === 'sliding' ? params.doors : 'none';
  return { width, height, depth, thickness, compartments, shelves, doors };
}

/** The exact solid panels of a cabinet. 2D, 3D, path tracing and export all derive from this list. */
export function cabinetPanels(input: CabinetParams): CabinetPanel[] {
  const { width, height, depth, thickness: t, compartments, shelves, doors } = normalizeCabinetParams(input);
  const panels: CabinetPanel[] = [];
  const innerWidth = width - 2 * t;
  const innerHeight = height - 2 * t;
  // Doors sit inside the overall depth so the plan footprint equals width x depth exactly.
  const doorZone = doors === 'none' ? 0 : doors === 'sliding' ? DOOR_THICKNESS + SLIDING_OFFSET : DOOR_THICKNESS;
  const carcassDepth = depth - doorZone;
  const carcassZ = -doorZone / 2;
  const shelfDepth = carcassDepth - BACK_THICKNESS;
  const shelfZ = carcassZ + BACK_THICKNESS / 2;

  for (const x of [-(width - t) / 2, (width - t) / 2]) {
    panels.push({ role: 'side', center: { x, y: height / 2, z: carcassZ }, size: { x: t, y: height, z: carcassDepth } });
  }
  panels.push({ role: 'bottom', center: { x: 0, y: t / 2, z: carcassZ }, size: { x: innerWidth, y: t, z: carcassDepth } });
  panels.push({ role: 'top', center: { x: 0, y: height - t / 2, z: carcassZ }, size: { x: innerWidth, y: t, z: carcassDepth } });
  panels.push({
    role: 'back',
    center: { x: 0, y: height / 2, z: carcassZ - (carcassDepth - BACK_THICKNESS) / 2 },
    size: { x: innerWidth, y: innerHeight, z: BACK_THICKNESS },
  });

  const bayWidth = (innerWidth - (compartments - 1) * t) / compartments;
  const bayCenter = (bay: number) => -innerWidth / 2 + bayWidth / 2 + bay * (bayWidth + t);
  for (let bay = 1; bay < compartments; bay++) {
    panels.push({
      role: 'divider',
      center: { x: bayCenter(bay) - (bayWidth + t) / 2, y: height / 2, z: shelfZ },
      size: { x: t, y: innerHeight, z: shelfDepth },
    });
  }

  for (let bay = 0; bay < compartments; bay++) {
    for (const fraction of shelves) {
      panels.push({
        role: 'shelf',
        center: { x: bayCenter(bay), y: t + fraction * innerHeight, z: shelfZ },
        size: { x: bayWidth, y: t, z: shelfDepth },
      });
    }
  }

  if (doors === 'hinged') {
    const doorWidth = width / compartments;
    for (let bay = 0; bay < compartments; bay++) {
      panels.push({
        role: 'door',
        center: { x: -width / 2 + doorWidth * (bay + 0.5), y: height / 2, z: depth / 2 - DOOR_THICKNESS / 2 },
        size: { x: doorWidth, y: height, z: DOOR_THICKNESS },
      });
    }
  } else if (doors === 'sliding') {
    const leaves = Math.max(2, compartments);
    const doorWidth = width / leaves;
    for (let leaf = 0; leaf < leaves; leaf++) {
      panels.push({
        role: 'door',
        center: {
          x: -width / 2 + doorWidth * (leaf + 0.5),
          y: height / 2,
          z: depth / 2 - DOOR_THICKNESS / 2 - (leaf % 2 === 0 ? 0 : SLIDING_OFFSET),
        },
        size: { x: doorWidth, y: height, z: DOOR_THICKNESS },
      });
    }
  }
  return panels;
}

/** Bounding box of a panel list; used to verify that panels fill the declared envelope. */
export function cabinetBounds(panels: CabinetPanel[]): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const { center, size } of panels) {
    for (const axis of ['x', 'y', 'z'] as const) {
      min[axis] = Math.min(min[axis], center[axis] - size[axis] / 2);
      max[axis] = Math.max(max[axis], center[axis] + size[axis] / 2);
    }
  }
  return { min, max };
}
