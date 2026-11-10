import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOUR_SEGMENT_MS, tourDurationMs, tourPose, type ViewPose } from '$lib/utils/savedViews';
import { readProject } from '$lib/utils/projectValidation';

const view = (x: number): ViewPose => ({ position: { x, y: 150, z: 0 }, target: { x: x + 100, y: 150, z: 0 } });

describe('tour path', () => {
  const views = [view(0), view(100), view(300)];

  it('lasts one segment between each pair of views', () => {
    expect(tourDurationMs(3)).toBe(2 * TOUR_SEGMENT_MS);
    expect(tourDurationMs(1)).toBe(0);
    expect(tourDurationMs(0)).toBe(0);
  });

  it('starts, passes through and ends on the saved views', () => {
    expect(tourPose(views, 0)).toEqual(views[0]);
    expect(tourPose(views, 0.5)).toEqual(views[1]);
    expect(tourPose(views, 1)).toEqual(views[2]);
  });

  it('eases so the middle of a segment is halfway and the start is slow', () => {
    expect(tourPose(views, 0.25).position.x).toBeCloseTo(50);
    expect(tourPose(views, 0.05).position.x).toBeLessThan(10);
  });

  it('clamps out of range and invalid progress', () => {
    expect(tourPose(views, -1)).toEqual(views[0]);
    expect(tourPose(views, 2)).toEqual(views[2]);
    expect(tourPose(views, Number.NaN)).toEqual(views[0]);
  });

  it('holds a single view and rejects an empty tour', () => {
    expect(tourPose([views[0]], 0.7)).toEqual(views[0]);
    expect(() => tourPose([], 0)).toThrow('at least one view');
  });
});

describe('saved views in project files', () => {
  const project = () => JSON.parse(readFileSync('tests/fixtures/sloped-walls.openplan.json', 'utf8'));
  const saved = { id: 'a', name: 'Kitchen', position: { x: 1, y: 2, z: 3 }, target: { x: 4, y: 5, z: 6 } };

  it('keeps valid views and leaves projects without views unchanged', () => {
    expect(readProject({ ...project(), savedViews: [saved] }).savedViews).toEqual([saved]);
    expect('savedViews' in readProject(project())).toBe(false);
  });

  it('rejects malformed views', () => {
    expect(() => readProject({ ...project(), savedViews: 'nope' })).toThrow();
    expect(() => readProject({ ...project(), savedViews: [{ ...saved, position: { x: 'a', y: 0, z: 0 } }] })).toThrow();
    expect(() => readProject({ ...project(), savedViews: [saved, saved] })).toThrow('duplicates');
  });
});
