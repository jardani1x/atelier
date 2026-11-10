import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Cabinet } from '$lib/models/types';
import { CABINET_FINISHES, cabinetFinishTexture } from '$lib/utils/cabinetFinishes';
import { createCabinetModel } from '$lib/utils/cabinetModel3d';
import {
  ROUGHNESS_MAP_CENTRE, TILE_SIZE_CM, applyPlanarBoxUvs, compensatedRoughness, heightToNormalPixels,
  heightToRoughnessPixels, luminanceOf, type PbrSet,
} from '$lib/utils/pbrMaps';

const texel = (pixels: ArrayLike<number>, i: number) => [pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]];

describe('derived maps', () => {
  it('reads luminance with Rec. 709 weights', () => {
    expect(luminanceOf([255, 0, 0, 255], 1, 1)[0]).toBeCloseTo(0.2126, 4);
    expect(luminanceOf([255, 255, 255, 255], 1, 1)[0]).toBeCloseTo(1, 4);
  });

  it('keeps a flat surface facing straight out', () => {
    const [x, y, z] = texel(heightToNormalPixels(new Float32Array(16).fill(0.5), 4, 4), 5);
    expect(Math.abs(x - 127.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(y - 127.5)).toBeLessThanOrEqual(1);
    expect(z).toBe(255);
  });

  it('tilts away from a slope rising to the right', () => {
    const ramp = new Float32Array(25).map((_, i) => (i % 5) / 4);
    expect(texel(heightToNormalPixels(ramp, 5, 5), 12)[0]).toBeLessThan(127);
  });

  it('tilts up in texture space when height rises towards lower rows', () => {
    // Image row grows downward while v grows upward, so this slope descends in +v.
    const ramp = new Float32Array(25).map((_, i) => Math.floor(i / 5) / 4);
    expect(texel(heightToNormalPixels(ramp, 5, 5), 12)[1]).toBeGreaterThan(128);
  });

  it('wraps at edges so a seam sees its neighbour on the opposite side', () => {
    const field = new Float32Array(9).fill(0);
    field[0] = 1;
    // Pixel 2 sits at the right edge; its right neighbour wraps to the raised pixel 0.
    expect(texel(heightToNormalPixels(field, 3, 3), 2)[0]).toBeLessThan(127);
  });

  it('makes dark detail rougher around the centre value', () => {
    const pixels = heightToRoughnessPixels([0, 1], 2, 1);
    expect(pixels[0]).toBeGreaterThan(ROUGHNESS_MAP_CENTRE * 255);
    expect(pixels[4]).toBeLessThan(ROUGHNESS_MAP_CENTRE * 255);
  });

  it('keeps the average roughness at the requested value', () => {
    expect(compensatedRoughness(0.4) * ROUGHNESS_MAP_CENTRE).toBeCloseTo(0.4, 6);
    expect(compensatedRoughness(1)).toBe(1);
  });
});

describe('planar box UVs', () => {
  it('measures every face in real centimetres from the panel origin', () => {
    const geometry = new THREE.BoxGeometry(100, 200, 50);
    applyPlanarBoxUvs(geometry, { x: 50, y: 100, z: 25 });
    const uv = geometry.getAttribute('uv'), normal = geometry.getAttribute('normal'), position = geometry.getAttribute('position');
    for (let i = 0; i < uv.count; i++) {
      const x = (position.getX(i) + 50) / TILE_SIZE_CM, y = (position.getY(i) + 100) / TILE_SIZE_CM, z = (position.getZ(i) + 25) / TILE_SIZE_CM;
      const [u, v] = Math.abs(normal.getX(i)) > 0.5 ? [z, y] : Math.abs(normal.getY(i)) > 0.5 ? [x, z] : [x, y];
      expect(uv.getX(i)).toBeCloseTo(u, 6);
      expect(uv.getY(i)).toBeCloseTo(v, 6);
    }
  });
});

describe('cabinet finish photos', () => {
  const base: Cabinet = {
    id: 'c', position: { x: 0, y: 0 }, rotation: 0, width: 100, height: 100, depth: 40, thickness: 2,
    compartments: 1, shelves: [], doors: 'none', color: CABINET_FINISHES.oak.color, roughness: 0.3, metalness: 0,
  };
  const pbr = { map: new THREE.Texture(), normalMap: new THREE.Texture(), roughnessMap: new THREE.Texture() } as unknown as PbrSet;
  const firstMaterial = (group: THREE.Group) => (group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;

  it('resolves a photo while roughness is tuned, and drops it for a custom colour', () => {
    expect(cabinetFinishTexture(base)).toBe('light-oak');
    expect(cabinetFinishTexture({ ...base, color: '#123456' })).toBeNull();
    expect(cabinetFinishTexture(CABINET_FINISHES.quartz)).toBeNull();
    expect(cabinetFinishTexture(CABINET_FINISHES.glass)).toBeNull();
  });

  it('applies all maps and neutral tint when the image is ready', () => {
    const material = firstMaterial(createCabinetModel(base, () => pbr));
    expect(material.map).toBe(pbr.map);
    expect(material.normalMap).toBe(pbr.normalMap);
    expect(material.roughnessMap).toBe(pbr.roughnessMap);
    expect(material.color.getHexString()).toBe('ffffff');
    expect(material.roughness).toBeCloseTo(compensatedRoughness(0.3), 6);
  });

  it('falls back to the plain finish while the image is loading', () => {
    const material = firstMaterial(createCabinetModel(base, () => null));
    expect(material.map).toBeNull();
    expect(material.color.getHexString()).toBe(new THREE.Color(base.color).getHexString());
  });
});
