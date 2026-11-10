import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Cabinet } from '$lib/models/types';
import { createCabinetModel } from '$lib/utils/cabinetModel3d';

const cabinet: Cabinet = {
  id: 'c1', position: { x: 300, y: 150 }, rotation: 0, width: 180, height: 240, depth: 60, thickness: 2,
  compartments: 3, shelves: [0.5], doors: 'none', color: '#a97c50', roughness: 0.6, metalness: 0,
};

function worldBox(item: Cabinet) {
  const group = createCabinetModel(item);
  group.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(group);
}

describe('createCabinetModel', () => {
  it('occupies the plan footprint and declared height', () => {
    const box = worldBox(cabinet);
    expect(box.min.x).toBeCloseTo(210, 4);
    expect(box.max.x).toBeCloseTo(390, 4);
    expect(box.min.z).toBeCloseTo(120, 4);
    expect(box.max.z).toBeCloseTo(180, 4);
    expect(box.min.y).toBeCloseTo(0, 4);
    expect(box.max.y).toBeCloseTo(240, 4);
  });

  it('turns the footprint by the plan rotation', () => {
    const box = worldBox({ ...cabinet, rotation: 90 });
    expect(box.max.x - box.min.x).toBeCloseTo(60, 4);
    expect(box.max.z - box.min.z).toBeCloseTo(180, 4);
  });

  it('rotates local +z to the same plan direction as a canvas rotation', () => {
    const group = createCabinetModel({ ...cabinet, rotation: 90 });
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion);
    // Canvas rotate(90deg) sends local +y to plan -x.
    expect(front.x).toBeCloseTo(-1, 4);
    expect(front.z).toBeCloseTo(0, 4);
  });

  it('creates one tagged solid mesh per panel', () => {
    const group = createCabinetModel(cabinet);
    // 2 sides, top, bottom, back, 2 dividers, 3 shelves.
    expect(group.children).toHaveLength(10);
    expect(group.children.filter(m => m.userData.cabinetRole === 'shelf')).toHaveLength(3);
    expect(group.children.every(m => m.userData.cabinetId === 'c1')).toBe(true);
  });
});
