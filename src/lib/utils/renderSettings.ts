import { writable } from 'svelte/store';

export type RenderQuality = 'performance' | 'balanced' | 'ultra' | 'photorealistic';
export type RenderLighting = 'day' | 'golden' | 'night';

export interface RenderQualitySettings {
  bounces: number;
  /** Accumulation stops here so an idle view does not keep the GPU busy. */
  targetSamples: number;
  tiles: number;
  renderScale: number;
}

export const RENDER_QUALITY: Record<RenderQuality, RenderQualitySettings> = {
  performance: { bounces: 2, targetSamples: 32, tiles: 3, renderScale: 0.5 },
  balanced: { bounces: 4, targetSamples: 128, tiles: 3, renderScale: 0.75 },
  ultra: { bounces: 6, targetSamples: 512, tiles: 2, renderScale: 1 },
  photorealistic: { bounces: 10, targetSamples: 2000, tiles: 1, renderScale: 1 },
};

export type RenderOutput = 'viewport' | 1920 | 3840;

export interface RenderSettings {
  quality: RenderQuality;
  lighting: RenderLighting;
  exposure: number;
  denoise: boolean;
  ceilingLights: boolean;
  /** Colour temperature of interior fittings, in kelvin. */
  lightTemperature: number;
  /** Multiplies the fittings' default brightness. */
  lightIntensity: number;
  /** Width of the rendered image in pixels, or the on-screen size. */
  output: RenderOutput;
}

export const DEFAULT_LIGHT_TEMPERATURE = 3000;
export const DEFAULT_LIGHT_INTENSITY = 1;

/** Every setting that needs accumulation to restart. Exposure and denoise only change how the image is displayed. */
export function renderTraceKey(settings: RenderSettings): string {
  const parts: (string | number)[] = [settings.quality, settings.lighting];
  if (settings.ceilingLights) parts.push('ceiling');
  if (settings.lightTemperature !== DEFAULT_LIGHT_TEMPERATURE) parts.push(`${settings.lightTemperature}K`);
  if (settings.lightIntensity !== DEFAULT_LIGHT_INTENSITY) parts.push(`x${settings.lightIntensity}`);
  if (settings.output !== 'viewport') parts.push(settings.output);
  return parts.join('/');
}

/** Pixel ratio giving the requested image width, limited so neither side exceeds what the GPU can hold. */
export function renderOutputPixelRatio(output: RenderOutput, cssWidth: number, cssHeight: number, devicePixelRatio: number, maxSize: number): number {
  if (output === 'viewport' || cssWidth <= 0 || cssHeight <= 0) return devicePixelRatio;
  return Math.min(output / cssWidth, maxSize / Math.max(cssWidth, cssHeight));
}

/** Noise falls with the square root of samples, so filtering weakens as the image converges and keeps texture detail. */
export function denoiseSigma(samples: number): number {
  return Math.min(5, Math.max(0.5, 5 * Math.sqrt(8 / Math.max(1, samples))));
}

/** Edge tolerance of the filter. Early samples differ strongly between neighbours, so a tight tolerance would keep the grain. */
export function denoiseThreshold(samples: number): number {
  return Math.min(0.3, Math.max(0.03, 0.3 * Math.sqrt(8 / Math.max(1, samples))));
}

export const renderModeEnabled = writable(false);
export const renderSettings = writable<RenderSettings>({
  quality: 'balanced', lighting: 'day', exposure: 1, denoise: true, ceilingLights: false,
  lightTemperature: DEFAULT_LIGHT_TEMPERATURE, lightIntensity: DEFAULT_LIGHT_INTENSITY, output: 'viewport',
});
