import { describe, expect, it } from 'vitest';
import type { Cabinet } from '$lib/models/types';
import { CABINET_PRESETS, findCabinetAt } from '$lib/utils/cabinetPlacement';
import { normalizeCabinetParams } from '$lib/utils/cabinetGeometry';
import { createCabinetModel } from '$lib/utils/cabinetModel3d';

function cabinet(id: string, rotation = 0): Cabinet {
  return { id, position: { x: 100, y: 100 }, rotation, width: 200, height: 220, depth: 40, thickness: 2, compartments: 2, shelves: [], doors: 'none', color: '#ffffff', roughness: 0.5, metalness: 0 };
}

describe('findCabinetAt', () => {
  it('uses width along local x and depth along local y', () => {
    expect(findCabinetAt({ x: 195, y: 100 }, [cabinet('a')])?.id).toBe('a');
    expect(findCabinetAt({ x: 100, y: 125 }, [cabinet('a')])).toBeNull();
  });

  it('follows rotation', () => {
    expect(findCabinetAt({ x: 100, y: 195 }, [cabinet('a', 90)])?.id).toBe('a');
    expect(findCabinetAt({ x: 195, y: 100 }, [cabinet('a', 90)])).toBeNull();
  });

  it('prefers the last cabinet and handles a floor without cabinets', () => {
    expect(findCabinetAt({ x: 100, y: 100 }, [cabinet('a'), cabinet('b')])?.id).toBe('b');
    expect(findCabinetAt({ x: 0, y: 0 }, undefined)).toBeNull();
  });
});

describe('CABINET_PRESETS', () => {
  it('keeps every preset unchanged by geometry limits', () => {
    for (const preset of Object.values(CABINET_PRESETS)) {
      const params = { width: preset.width!, height: preset.height!, depth: preset.depth!, thickness: 1.8, compartments: preset.compartments!, shelves: preset.shelves!, doors: preset.doors! };
      expect(normalizeCabinetParams(params)).toEqual(params);
    }
  });
});

describe('cabinet elevation', () => {
  it('raises the 3D model above the floor and defaults to floor level', () => {
    expect(createCabinetModel(cabinet('a')).position.y).toBe(0);
    expect(createCabinetModel({ ...cabinet('a'), elevation: 145 }).position.y).toBe(145);
  });
});
