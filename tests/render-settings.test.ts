import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RENDER_QUALITY } from '$lib/utils/renderSettings';
import { createLightingEnvironment, LIGHTING_PRESETS } from '$lib/utils/renderEnvironment';

function meanRadiance(texture: THREE.DataTexture) {
  const data = texture.image.data as Float32Array;
  let total = 0;
  for (let i = 0; i < data.length; i += 4) total += data[i] + data[i + 1] + data[i + 2];
  return total / (data.length / 4);
}

describe('render quality presets', () => {
  it('increase bounces and samples in order', () => {
    const presets = [RENDER_QUALITY.performance, RENDER_QUALITY.balanced, RENDER_QUALITY.ultra, RENDER_QUALITY.photorealistic];
    for (let i = 1; i < presets.length; i++) {
      expect(presets[i].bounces).toBeGreaterThan(presets[i - 1].bounces);
      expect(presets[i].targetSamples).toBeGreaterThan(presets[i - 1].targetSamples);
    }
  });
});

describe('lighting environments', () => {
  it('uses readable float pixels for the tracer', () => {
    const texture = createLightingEnvironment('day', 64, 32);
    expect(texture.image.data).toBeInstanceOf(Float32Array);
    expect(texture.mapping).toBe(THREE.EquirectangularReflectionMapping);
  });

  it('places the sun at the preset direction', () => {
    const width = 256, height = 128;
    const { sun } = LIGHTING_PRESETS.day;
    const data = createLightingEnvironment('day', width, height).image.data as Float32Array;
    const x = Math.floor((sun!.azimuth / (2 * Math.PI) + 0.5) * width);
    const y = Math.floor(((sun!.elevation + Math.PI / 2) / Math.PI) * height);
    expect(data[(y * width + x) * 4]).toBe(sun!.radiance[0]);
  });

  it('makes night far darker than day and golden hour', () => {
    const night = meanRadiance(createLightingEnvironment('night', 64, 32));
    expect(meanRadiance(createLightingEnvironment('day', 64, 32))).toBeGreaterThan(night * 20);
    expect(meanRadiance(createLightingEnvironment('golden', 64, 32))).toBeGreaterThan(night * 20);
  });
});
