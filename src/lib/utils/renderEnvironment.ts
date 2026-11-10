import * as THREE from 'three';
import type { RenderLighting } from '$lib/utils/renderSettings';

type Rgb = [number, number, number];

interface LightingPreset {
  zenith: Rgb;
  horizon: Rgb;
  ground: Rgb;
  sun: { elevation: number; azimuth: number; radius: number; radiance: Rgb } | null;
  interiorLight: boolean;
}

const DEGREE = Math.PI / 180;

/** Colours are linear radiance. These are artistic presets, not a calibrated sky model. */
export const LIGHTING_PRESETS: Record<RenderLighting, LightingPreset> = {
  day: { zenith: [0.45, 0.62, 0.95], horizon: [1.1, 1.1, 1.05], ground: [0.32, 0.3, 0.28], sun: { elevation: 55 * DEGREE, azimuth: 40 * DEGREE, radius: 4 * DEGREE, radiance: [260, 245, 225] }, interiorLight: false },
  golden: { zenith: [0.3, 0.36, 0.6], horizon: [1.3, 0.8, 0.45], ground: [0.22, 0.17, 0.13], sun: { elevation: 12 * DEGREE, azimuth: 40 * DEGREE, radius: 4 * DEGREE, radiance: [240, 130, 60] }, interiorLight: false },
  night: { zenith: [0.006, 0.009, 0.022], horizon: [0.018, 0.022, 0.04], ground: [0.005, 0.005, 0.006], sun: null, interiorLight: true },
};

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
}

/** Row 0 is the nadir and u = 0.5 faces +x, matching three's equirectangular lookup. */
export function createLightingEnvironment(id: RenderLighting, width = 512, height = 256): THREE.DataTexture {
  const preset = LIGHTING_PRESETS[id];
  const pixels = new Float32Array(width * height * 4);
  const sunDot = preset.sun ? Math.cos(preset.sun.radius) : 2;
  const sunDirection = preset.sun
    ? new THREE.Vector3(Math.cos(preset.sun.elevation) * Math.cos(preset.sun.azimuth), Math.sin(preset.sun.elevation), Math.cos(preset.sun.elevation) * Math.sin(preset.sun.azimuth))
    : null;
  const direction = new THREE.Vector3();
  for (let y = 0; y < height; y++) {
    const elevation = ((y + 0.5) / height) * Math.PI - Math.PI / 2;
    const base = elevation < 0 ? preset.ground : mix(preset.horizon, preset.zenith, Math.pow(Math.sin(elevation), 0.6));
    for (let x = 0; x < width; x++) {
      const azimuth = ((x + 0.5) / width - 0.5) * 2 * Math.PI;
      direction.set(Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.sin(azimuth));
      const colour = sunDirection && direction.dot(sunDirection) >= sunDot ? preset.sun!.radiance : base;
      pixels.set([colour[0], colour[1], colour[2], 1], (y * width + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
