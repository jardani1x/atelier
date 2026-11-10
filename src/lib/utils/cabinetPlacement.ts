import type { Cabinet, Point } from '$lib/models/types';

export type CabinetOverrides = Partial<Omit<Cabinet, 'id' | 'position'>>;
export type CabinetPresetId = 'wardrobe' | 'kitchenBase' | 'kitchenWall' | 'tvWall' | 'storage' | 'shelves' | 'studyTable' | 'countertop';

/** Sizes are starting points in cm; every value stays editable after placement. */
export const CABINET_PRESETS: Record<CabinetPresetId, CabinetOverrides> = {
  wardrobe: { name: 'Wardrobe', width: 180, height: 240, depth: 60, compartments: 3, shelves: [0.2, 0.8], doors: 'hinged', color: '#b08d62' },
  kitchenBase: { name: 'Kitchen base cabinet', width: 240, height: 85, depth: 60, compartments: 4, shelves: [0.5], doors: 'hinged', color: '#e8e4dc' },
  kitchenWall: { name: 'Kitchen wall cabinet', width: 240, height: 70, depth: 35, compartments: 4, shelves: [0.5], doors: 'hinged', color: '#e8e4dc', elevation: 145 },
  tvWall: { name: 'TV feature wall', width: 300, height: 45, depth: 40, compartments: 3, shelves: [], doors: 'sliding', color: '#6b5240' },
  storage: { name: 'Storage cabinet', width: 100, height: 200, depth: 45, compartments: 2, shelves: [0.25, 0.5, 0.75], doors: 'hinged', color: '#c9b79c' },
  shelves: { name: 'Open shelves', width: 120, height: 180, depth: 30, compartments: 2, shelves: [0.2, 0.4, 0.6, 0.8], doors: 'none', color: '#a97c50' },
  studyTable: { name: 'Study table', width: 140, height: 75, depth: 60, compartments: 1, shelves: [], doors: 'none', color: '#b89468' },
  countertop: { name: 'Countertop', width: 240, height: 10, depth: 62, compartments: 1, shelves: [], doors: 'none', color: '#d9d6d0', roughness: 0.25, elevation: 85 },
};

/** Tests a plan point against the rotated footprint; the most recently added cabinet wins. */
export function findCabinetAt(point: Point, cabinets: Cabinet[] | undefined): Cabinet | null {
  if (!cabinets) return null;
  for (const cabinet of [...cabinets].reverse()) {
    const angle = (cabinet.rotation * Math.PI) / 180;
    const dx = point.x - cabinet.position.x;
    const dy = point.y - cabinet.position.y;
    const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
    const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
    if (Math.abs(localX) <= cabinet.width / 2 && Math.abs(localY) <= cabinet.depth / 2) return cabinet;
  }
  return null;
}
