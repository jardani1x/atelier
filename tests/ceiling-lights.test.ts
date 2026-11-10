import { describe, expect, it } from 'vitest';
import {
  CEILING_LIGHT_DROP_CM, MAX_CEILING_LIGHTS, ceilingLightPositions, kelvinToRgb, layoutCeilingLights, pointInPolygon, viewpointInsideRoom,
} from '$lib/utils/ceilingLights';
import {
  DEFAULT_LIGHT_INTENSITY, DEFAULT_LIGHT_TEMPERATURE, denoiseSigma, denoiseThreshold, renderOutputPixelRatio, renderTraceKey, type RenderSettings,
} from '$lib/utils/renderSettings';

describe('render settings helpers', () => {
  const base: RenderSettings = {
    quality: 'performance', lighting: 'day', exposure: 1, denoise: true, ceilingLights: false,
    lightTemperature: DEFAULT_LIGHT_TEMPERATURE, lightIntensity: DEFAULT_LIGHT_INTENSITY, output: 'viewport',
  };

  it('restarts accumulation only for settings that change the traced image', () => {
    expect(renderTraceKey(base)).toBe('performance/day');
    expect(renderTraceKey({ ...base, exposure: 2, denoise: false })).toBe('performance/day');
    expect(renderTraceKey({ ...base, ceilingLights: true, lightTemperature: 4000, lightIntensity: 2, output: 1920 }))
      .toBe('performance/day/ceiling/4000K/x2/1920');
  });

  it('computes a pixel ratio that yields the requested width', () => {
    expect(renderOutputPixelRatio(1920, 960, 540, 1, 16384)).toBe(2);
    expect(renderOutputPixelRatio('viewport', 960, 540, 1.5, 16384)).toBe(1.5);
  });

  it('limits output to the largest texture the GPU supports', () => {
    expect(renderOutputPixelRatio(3840, 1000, 2000, 1, 4096)).toBeCloseTo(4096 / 2000, 6);
  });

  it('filters less as samples accumulate, within shader-safe bounds', () => {
    expect(denoiseSigma(1)).toBe(5);
    expect(denoiseSigma(128)).toBeLessThan(denoiseSigma(8));
    expect(denoiseSigma(1_000_000)).toBe(0.5);
    expect(denoiseThreshold(1)).toBe(0.3);
    expect(denoiseThreshold(128)).toBeLessThan(denoiseThreshold(8));
    expect(denoiseThreshold(1_000_000)).toBe(0.03);
  });
});

const square = (size: number, x = 0, y = 0) => [
  { x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size },
];

describe('kelvinToRgb', () => {
  it('is warm at tungsten temperatures', () => {
    const [r, g, b] = kelvinToRgb(2700);
    expect(r).toBe(1);
    expect(g).toBeLessThan(0.75);
    expect(b).toBeLessThan(g);
  });

  it('is near neutral at daylight and blue above it', () => {
    const [r, g, b] = kelvinToRgb(6500);
    expect(Math.min(r, g, b)).toBeGreaterThan(0.9);
    const [hotR, , hotB] = kelvinToRgb(10000);
    expect(hotB).toBe(1);
    expect(hotR).toBeLessThan(0.85);
  });

  it('always stays in range', () => {
    for (const kelvin of [-5, 0, 1000, 1900, 6600, 40000, 90000]) {
      for (const channel of kelvinToRgb(kelvin)) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('ceiling light layout', () => {
  it('treats a viewpoint as inside only under a ceiling', () => {
    const rooms = [{ outline: square(10), height: 250 }];
    expect(viewpointInsideRoom({ x: 5, y: 150, z: 5 }, rooms)).toBe(true);
    expect(viewpointInsideRoom({ x: 5, y: 300, z: 5 }, rooms)).toBe(false);
    expect(viewpointInsideRoom({ x: 50, y: 150, z: 5 }, rooms)).toBe(false);
  });

  it('detects inside and outside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square(10))).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square(10))).toBe(false);
  });

  it('centres one fitting in a small room, just below the ceiling', () => {
    expect(ceilingLightPositions(square(150), 260)).toEqual([{ x: 75, y: 260 - CEILING_LIGHT_DROP_CM, z: 75 }]);
  });

  it('spreads a grid across a large room', () => {
    const lights = ceilingLightPositions(square(400), 260);
    expect(lights.map((l) => [l.x, l.z])).toEqual([[100, 100], [300, 100], [100, 300], [300, 300]]);
  });

  it('keeps every fitting inside an L-shaped room', () => {
    const outline = [
      { x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 600 }, { x: 0, y: 600 },
    ];
    const lights = ceilingLightPositions(outline, 260);
    expect(lights.length).toBeGreaterThan(1);
    for (const light of lights) expect(pointInPolygon({ x: light.x, y: light.z }, outline)).toBe(true);
  });

  it('still lights a room whose grid cell centre falls outside', () => {
    const outline = [{ x: 0, y: 0 }, { x: 190, y: 0 }, { x: 190, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 190 }, { x: 0, y: 190 }];
    expect(ceilingLightPositions(outline, 260)).toHaveLength(1);
  });

  it('returns nothing for a degenerate outline', () => {
    expect(ceilingLightPositions([{ x: 0, y: 0 }, { x: 1, y: 0 }], 260)).toEqual([]);
  });

  it('caps a large home and still reaches the last room', () => {
    const rooms = Array.from({ length: 10 }, (_, i) => ({ outline: square(800, i * 1000), height: 260 }));
    const lights = layoutCeilingLights(rooms);
    expect(lights).toHaveLength(MAX_CEILING_LIGHTS);
    expect(Math.max(...lights.map((l) => l.x))).toBeGreaterThan(9000);
  });
});
