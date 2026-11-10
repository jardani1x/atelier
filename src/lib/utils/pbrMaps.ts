import * as THREE from 'three';
import { ownTexture } from './furnitureModelResources';

/** Real-world span of one texture image, matching floors and walls. */
export const TILE_SIZE_CM = 200;
/** Roughness maps centre here so strokes can go both rougher and smoother than the slider value. */
export const ROUGHNESS_MAP_CENTRE = 0.8;

const NORMAL_STRENGTH = 2;
const ROUGHNESS_VARIATION = 0.35;
const MAX_MAP_SIZE = 512;

/** Rec. 709 luminance per pixel, 0..1. */
export function luminanceOf(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    out[i] = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
  }
  return out;
}

/** Sobel gradient of a height field to OpenGL tangent-space normals. Wraps at edges so tiles stay seamless. */
export function heightToNormalPixels(field: ArrayLike<number>, width: number, height: number, strength = NORMAL_STRENGTH): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4);
  const at = (x: number, y: number) => field[((y + height) % height) * width + ((x + width) % width)];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / 8;
      const dRow = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 8;
      // Image rows run opposite to texture v, so the row gradient keeps its sign.
      const nx = -dx * strength * 8, ny = dRow * strength * 8, nz = 1;
      const length = Math.hypot(nx, ny, nz);
      const i = (y * width + x) * 4;
      out[i] = (nx / length * 0.5 + 0.5) * 255;
      out[i + 1] = (ny / length * 0.5 + 0.5) * 255;
      out[i + 2] = (nz / length * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Dark detail such as grout or grain reads rougher than the polished surface around it. */
export function heightToRoughnessPixels(field: ArrayLike<number>, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const count = width * height;
  let mean = 0;
  for (let i = 0; i < count; i++) mean += field[i];
  mean /= count || 1;
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const value = Math.min(1, Math.max(0, ROUGHNESS_MAP_CENTRE - (field[i] - mean) * ROUGHNESS_VARIATION * 2)) * 255;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = value;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** The material value that averages to `base` once multiplied by a centred roughness map. */
export function compensatedRoughness(base: number): number {
  return Math.min(1, base / ROUGHNESS_MAP_CENTRE);
}

/** Replaces box UVs with planar projection in centimetres, so grain keeps real scale and runs across adjoining panels. */
export function applyPlanarBoxUvs(geometry: THREE.BufferGeometry, offset: { x: number; y: number; z: number }, tileCm = TILE_SIZE_CM) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) + offset.x, y = position.getY(i) + offset.y, z = position.getZ(i) + offset.z;
    if (Math.abs(normal.getX(i)) > 0.5) uv.setXY(i, z / tileCm, y / tileCm);
    else if (Math.abs(normal.getY(i)) > 0.5) uv.setXY(i, x / tileCm, z / tileCm);
    else uv.setXY(i, x / tileCm, y / tileCm);
  }
  uv.needsUpdate = true;
}

export interface PbrSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

const derivedMaps = new WeakMap<HTMLCanvasElement, { normal: HTMLCanvasElement; roughness: HTMLCanvasElement }>();
const sharedSources = new WeakMap<HTMLCanvasElement, THREE.CanvasTexture['source']>();

function canvasFrom(pixels: Uint8ClampedArray<ArrayBuffer>, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas;
}

function deriveMaps(source: HTMLCanvasElement) {
  const cached = derivedMaps.get(source);
  if (cached) return cached;
  const scale = Math.min(1, MAX_MAP_SIZE / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const sample = document.createElement('canvas');
  sample.width = width;
  sample.height = height;
  const context = sample.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(source, 0, 0, width, height);
  const luminance = luminanceOf(context.getImageData(0, 0, width, height).data, width, height);
  const maps = {
    normal: canvasFrom(heightToNormalPixels(luminance, width, height), width, height),
    roughness: canvasFrom(heightToRoughnessPixels(luminance, width, height), width, height),
  };
  derivedMaps.set(source, maps);
  return maps;
}

/** Wrappers over one canvas share a Source: the GPU uploads it once, and the path tracer's texture atlas stores one layer. */
function ownSharedTexture(canvas: HTMLCanvasElement, colorSpace: THREE.ColorSpace) {
  const texture = ownTexture(new THREE.CanvasTexture(canvas));
  const shared = sharedSources.get(canvas);
  if (shared) texture.source = shared;
  else sharedSources.set(canvas, texture.source);
  texture.colorSpace = colorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Colour, normal and roughness textures for a tiling image. Normal and roughness are estimated from brightness, not scanned. */
export function createPbrSet(colorCanvas: HTMLCanvasElement): PbrSet {
  const maps = deriveMaps(colorCanvas);
  return {
    map: ownSharedTexture(colorCanvas, THREE.SRGBColorSpace),
    normalMap: ownSharedTexture(maps.normal, THREE.NoColorSpace),
    roughnessMap: ownSharedTexture(maps.roughness, THREE.NoColorSpace),
  };
}
