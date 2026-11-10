import { describe, expect, it } from 'vitest';
import { cabinetBounds, cabinetPanels, normalizeCabinetParams, type CabinetParams } from '$lib/utils/cabinetGeometry';

const base: CabinetParams = { width: 180, height: 240, depth: 60, thickness: 2, compartments: 3, shelves: [0.25, 0.5], doors: 'none' };
const count = (params: CabinetParams, role: string) => cabinetPanels(params).filter(p => p.role === role).length;

function expectEnvelope(params: CabinetParams) {
  const { min, max } = cabinetBounds(cabinetPanels(params));
  expect(max.x - min.x).toBeCloseTo(params.width, 6);
  expect(max.y - min.y).toBeCloseTo(params.height, 6);
  expect(max.z - min.z).toBeCloseTo(params.depth, 6);
  expect(min.y).toBeCloseTo(0, 6);
  expect(min.x).toBeCloseTo(-params.width / 2, 6);
  expect(min.z).toBeCloseTo(-params.depth / 2, 6);
}

describe('cabinetPanels', () => {
  it('fills the exact declared envelope for every door style', () => {
    expectEnvelope(base);
    expectEnvelope({ ...base, doors: 'hinged' });
    expectEnvelope({ ...base, doors: 'sliding' });
  });

  it('creates one divider between each bay and shelves in every bay', () => {
    expect(count(base, 'side')).toBe(2);
    expect(count(base, 'divider')).toBe(2);
    expect(count(base, 'shelf')).toBe(6);
    expect(count(base, 'door')).toBe(0);
  });

  it('gives each bay equal clear width', () => {
    const panels = cabinetPanels(base);
    const edges = panels.filter(p => p.role === 'side' || p.role === 'divider')
      .map(p => [p.center.x - p.size.x / 2, p.center.x + p.size.x / 2]).sort((a, b) => a[0] - b[0]);
    const gaps = edges.slice(1).map((edge, i) => edge[0] - edges[i][1]);
    expect(gaps).toHaveLength(3);
    for (const gap of gaps) expect(gap).toBeCloseTo((180 - 4 * 2) / 3, 6);
  });

  it('places shelves at the requested fraction of interior height', () => {
    const shelf = cabinetPanels({ ...base, shelves: [0.5] }).find(p => p.role === 'shelf')!;
    expect(shelf.center.y).toBeCloseTo(2 + 0.5 * (240 - 4), 6);
  });

  it('makes hinged doors cover the full front without overlap', () => {
    const doors = cabinetPanels({ ...base, doors: 'hinged' }).filter(p => p.role === 'door');
    expect(doors).toHaveLength(3);
    expect(doors.reduce((sum, d) => sum + d.size.x, 0)).toBeCloseTo(180, 6);
  });

  it('puts adjacent sliding doors on separate tracks', () => {
    const doors = cabinetPanels({ ...base, compartments: 1, doors: 'sliding' }).filter(p => p.role === 'door');
    expect(doors).toHaveLength(2);
    expect(Math.abs(doors[0].center.z - doors[1].center.z)).toBeGreaterThanOrEqual(doors[0].size.z);
  });

  it('never produces a non-positive panel from hostile input', () => {
    const hostile = [
      { ...base, width: 0, height: -5, depth: NaN },
      { ...base, thickness: 500 },
      { ...base, compartments: 9999, width: 10 },
      { ...base, shelves: [NaN, -1, 2, 0, 1] },
      { ...base, compartments: NaN, doors: 'sliding' as const },
    ];
    for (const params of hostile) {
      for (const panel of cabinetPanels(params)) {
        for (const value of Object.values(panel.size)) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThan(0);
        }
      }
    }
  });

  it('drops invalid and duplicate shelves and sorts the rest', () => {
    expect(normalizeCabinetParams({ ...base, shelves: [0.7, 0.2, 0.7, 1.5, NaN] }).shelves).toEqual([0.2, 0.7]);
  });
});
