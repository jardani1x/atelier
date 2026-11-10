import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { buildExportRoot, modelToOBJ } from '$lib/utils/modelExport';
import { CABINET_FINISHES, CABINET_FINISH_IDS, matchCabinetFinish } from '$lib/utils/cabinetFinishes';
import { houseTemplates } from '$lib/utils/houseTemplates';
import { detectRooms } from '$lib/utils/roomDetection';

describe('model export', () => {
  it('writes metres that parse back with the original size', () => {
    const scene = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(350, 260, 20), new THREE.MeshStandardMaterial());
    box.position.set(100, 130, 0);
    scene.add(box);
    const parsed = new OBJLoader().parse(modelToOBJ(buildExportRoot(scene)));
    const size = new THREE.Box3().setFromObject(parsed).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(3.5, 5);
    expect(size.y).toBeCloseTo(2.6, 5);
    expect(size.z).toBeCloseTo(0.2, 5);
  });

  it('leaves out excluded and hidden objects', () => {
    const scene = new THREE.Scene();
    const excluded = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const hidden = excluded.clone(); hidden.visible = false;
    const kept = excluded.clone();
    scene.add(excluded, hidden, kept);
    expect(buildExportRoot(scene, new Set([excluded])).children).toHaveLength(1);
  });
});

describe('cabinet finishes', () => {
  it('recognises each preset and rejects edited values', () => {
    for (const id of CABINET_FINISH_IDS) expect(matchCabinetFinish(CABINET_FINISHES[id])).toBe(id);
    expect(matchCabinetFinish({ ...CABINET_FINISHES.oak, roughness: 0.56 })).toBe('');
  });
});

describe('four-room HDB template', () => {
  const template = houseTemplates.find((item) => item.name === '4-Room HDB Flat')!;

  it('detects each enclosed room', () => {
    expect(detectRooms(template.create().floors[0].walls)).toHaveLength(8);
  });

  it('spans about 90 square metres on its centre lines', () => {
    const points = template.create().floors[0].walls.flatMap((wall) => [wall.start, wall.end]);
    const width = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    const depth = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
    expect((width * depth) / 10000).toBeCloseTo(90.2, 1);
  });

  it('attaches every opening to a wall long enough to hold it', () => {
    const floor = template.create().floors[0];
    for (const opening of [...floor.doors, ...floor.windows]) {
      const wall = floor.walls.find((item) => item.id === opening.wallId)!;
      expect(Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)).toBeGreaterThan(opening.width);
    }
  });
});
