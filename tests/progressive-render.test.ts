import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { collectTraceScene } from '$lib/utils/progressiveRender';

function mesh() {
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
}

describe('collectTraceScene', () => {
  it('splits a multi-material mesh so each traced mesh has one material', () => {
    const scene = new THREE.Scene();
    const faces = Array.from({ length: 6 }, () => new THREE.MeshStandardMaterial());
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), faces);
    scene.add(box);
    const parts = collectTraceScene(scene).children as THREE.Mesh[];
    expect(parts.map((part) => part.material)).toEqual(faces);
    expect(parts.map((part) => part.geometry.index!.count)).toEqual([6, 6, 6, 6, 6, 6]);
    expect(parts[1].geometry.attributes.position).toBe(box.geometry.attributes.position);
    expect(Array.from(parts[1].geometry.index!.array)).toEqual(Array.from(box.geometry.index!.array.slice(6, 12)));
  });

  it('omits ceilings by default and makes them double sided only in solid mode', () => {
    const scene = new THREE.Scene();
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ side: THREE.BackSide }));
    ceiling.userData.renderExclude = true;
    ceiling.userData.ceilingOutline = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    scene.add(ceiling);
    expect(collectTraceScene(scene).children).toHaveLength(0);
    const reflect = collectTraceScene(scene, new Set(), undefined, 'reflect').children[0] as THREE.Mesh;
    expect(reflect.material).toBe(ceiling.material);
    const solid = collectTraceScene(scene, new Set(), undefined, 'solid').children[0] as THREE.Mesh;
    expect((solid.material as THREE.Material).side).toBe(THREE.DoubleSide);
    expect((ceiling.material as THREE.Material).side).toBe(THREE.BackSide);
  });

  it('flattens nested meshes to their world transforms and shares geometry', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.position.set(10, 0, 5);
    const box = mesh();
    box.position.y = 3;
    group.add(box);
    scene.add(group);
    const traced = collectTraceScene(scene);
    expect(traced.children).toHaveLength(1);
    const copy = traced.children[0] as THREE.Mesh;
    expect(copy.geometry).toBe(box.geometry);
    expect(new THREE.Vector3().setFromMatrixPosition(copy.matrixWorld).toArray()).toEqual([10, 3, 5]);
  });

  it('skips hidden, render-excluded and explicitly excluded branches', () => {
    const scene = new THREE.Scene();
    const hidden = mesh(); hidden.visible = false;
    const flagged = new THREE.Group(); flagged.userData.renderExclude = true; flagged.add(mesh());
    const ground = mesh();
    const kept = mesh();
    scene.add(hidden, flagged, ground, kept);
    const traced = collectTraceScene(scene, new Set([ground]));
    expect(traced.children).toHaveLength(1);
    expect((traced.children[0] as THREE.Mesh).geometry).toBe(kept.geometry);
  });

  it('keeps cabinet tags and places light targets in world space', () => {
    const scene = new THREE.Scene();
    const panel = mesh(); panel.userData.cabinetRole = 'door';
    const sun = new THREE.DirectionalLight();
    sun.position.set(1, 9, 2);
    sun.target.position.set(4, 0, 4);
    scene.add(panel, sun, sun.target);
    const traced = collectTraceScene(scene);
    expect(traced.children.find(n => n instanceof THREE.Mesh)!.userData.cabinetRole).toBe('door');
    const light = traced.children.find(n => n instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
    expect(light.position.toArray()).toEqual([1, 9, 2]);
    expect(light.target.position.toArray()).toEqual([4, 0, 4]);
  });

  function canvasSky() {
    // 1 x 2: red on the top row, black below.
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255]);
    const canvas = { width: 1, height: 2, getContext: () => ({ getImageData: () => ({ data }) }) };
    const texture = new THREE.Texture(canvas as unknown as HTMLCanvasElement);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  it('turns a canvas sky into pixel data the tracer can importance-sample', () => {
    const scene = new THREE.Scene();
    scene.background = canvasSky();
    const traced = collectTraceScene(scene);
    const environment = traced.environment as THREE.DataTexture;
    expect(traced.background).toBe(environment);
    expect(environment.type).toBe(THREE.HalfFloatType);
    expect(environment.colorSpace).toBe(THREE.LinearSRGBColorSpace);
    expect(environment.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(environment.flipY).toBe(false);
    const pixels = environment.image.data as Uint16Array;
    expect(Array.from(pixels.subarray(0, 3))).toEqual([0, 0, 0]);
    expect(pixels[4]).toBe(THREE.DataUtils.toHalfFloat(1));
  });

  it('leaves the environment empty when a texture has no readable pixels', () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Texture();
    expect(collectTraceScene(scene).environment).toBeNull();
  });
});
