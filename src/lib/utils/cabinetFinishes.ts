import type { Cabinet } from '$lib/models/types';

export type CabinetFinishId =
  | 'oak' | 'walnut' | 'marbleWhite' | 'quartz' | 'tile' | 'concrete' | 'glass'
  | 'steel' | 'blackMetal' | 'paintWhite' | 'fabricGrey' | 'leatherTan' | 'stoneSlate';

export type CabinetFinish = Pick<Cabinet, 'color' | 'roughness' | 'metalness'> & { transmission: number };

/** PBR values chosen by eye. See CABINET_FINISH_TEXTURES for finishes that also use a photo. */
export const CABINET_FINISHES: Record<CabinetFinishId, CabinetFinish> = {
  oak: { color: '#b08d62', roughness: 0.55, metalness: 0, transmission: 0 },
  walnut: { color: '#5c4033', roughness: 0.5, metalness: 0, transmission: 0 },
  marbleWhite: { color: '#f2efe9', roughness: 0.12, metalness: 0, transmission: 0 },
  quartz: { color: '#dcd9d3', roughness: 0.2, metalness: 0, transmission: 0 },
  tile: { color: '#e7e4dd', roughness: 0.25, metalness: 0, transmission: 0 },
  concrete: { color: '#8d8d8a', roughness: 0.85, metalness: 0, transmission: 0 },
  glass: { color: '#dfeeee', roughness: 0.05, metalness: 0, transmission: 0.9 },
  steel: { color: '#b8b8b8', roughness: 0.35, metalness: 1, transmission: 0 },
  blackMetal: { color: '#2a2a2a', roughness: 0.45, metalness: 1, transmission: 0 },
  paintWhite: { color: '#f5f5f0', roughness: 0.7, metalness: 0, transmission: 0 },
  fabricGrey: { color: '#77777a', roughness: 0.95, metalness: 0, transmission: 0 },
  leatherTan: { color: '#8a5a36', roughness: 0.5, metalness: 0, transmission: 0 },
  stoneSlate: { color: '#55585c', roughness: 0.8, metalness: 0, transmission: 0 },
};

export const CABINET_FINISH_IDS = Object.keys(CABINET_FINISHES) as CabinetFinishId[];

/** Finishes backed by a tiling photo. Kept apart from CABINET_FINISHES, whose fields are copied onto cabinets. */
export const CABINET_FINISH_TEXTURES: Partial<Record<CabinetFinishId, string>> = {
  oak: 'light-oak', walnut: 'walnut', marbleWhite: 'marble-white', tile: 'ceramic-white', concrete: 'concrete', stoneSlate: 'slate',
};

/** The photo for a cabinet's finish. Roughness may be tuned freely; choosing a custom colour drops the photo. */
export function cabinetFinishTexture(cabinet: Pick<Cabinet, 'color' | 'metalness' | 'transmission'>): string | null {
  if (cabinet.transmission) return null;
  const id = CABINET_FINISH_IDS.find((candidate) => CABINET_FINISHES[candidate].color === cabinet.color.toLowerCase()
    && CABINET_FINISHES[candidate].metalness === cabinet.metalness);
  return id ? CABINET_FINISH_TEXTURES[id] ?? null : null;
}

/** Returns '' once a user has adjusted colour or roughness away from every preset. */
export function matchCabinetFinish(cabinet: Pick<Cabinet, 'color' | 'roughness' | 'metalness' | 'transmission'>): CabinetFinishId | '' {
  return CABINET_FINISH_IDS.find((id) => {
    const finish = CABINET_FINISHES[id];
    return finish.color === cabinet.color.toLowerCase() && finish.roughness === cabinet.roughness
      && finish.metalness === cabinet.metalness && finish.transmission === (cabinet.transmission ?? 0);
  }) ?? '';
}
