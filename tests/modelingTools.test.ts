import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Floor, Solid } from '$lib/models/types';
import { createModelingTools, parseRectangleInput, pushDistance, pushTargetFromHit, type FaceHit, type ModelToolState } from '$lib/utils/modelingTools';

function setup() {
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 10000);
  camera.position.set(0, 500, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const solids: Omit<Solid, 'id'>[] = [];
  const pushes: unknown[] = [];
  let state: ModelToolState | null = null;
  const root = new THREE.Group();
  const scene = new THREE.Scene();
  const tools = createModelingTools({
    camera: () => camera,
    root: () => root,
    scene: () => scene,
    floor: () => null,
    units: () => 'metric',
    invalidate: vi.fn(),
    addSolid: (solid) => { solids.push(solid); return 's1'; },
    applyPushPull: (target, distance) => { pushes.push({ target, distance }); return null; },
    onState: (next) => { state = next; },
  });
  return { tools, solids, pushes, root, current: () => state! };
}

const centre = new THREE.Vector2(0, 0);

describe('modelling tool flow', () => {
  it('draws a typed rectangle on the ground and hands it to push/pull', () => {
    const { tools, solids, pushes, current } = setup();
    tools.setTool('rectangle');
    tools.click(centre);
    expect(current().active).toBe(true);
    expect(tools.submit('120, 60')).toBe(true);
    expect(solids).toHaveLength(1);
    expect(solids[0].depth).toBe(1);
    expect(tools.tool).toBe('pushpull');
    expect(current().active).toBe(true);
    expect(tools.submit('2 m')).toBe(true);
    expect(pushes).toEqual([{ target: { kind: 'solid', id: 's1', face: 'top' }, distance: 200 }]);
    expect(current().active).toBe(false);
  });

  it('stores shapes relative to an offset floor root', () => {
    const { tools, solids, root } = setup();
    root.position.y = 300;
    tools.setTool('rectangle');
    tools.click(centre);
    tools.submit('50');
    expect(solids[0].origin.y).toBeCloseTo(-300);
  });

  it('rejects unreadable values and keeps the operation open', () => {
    const { tools, current } = setup();
    tools.setTool('circle');
    tools.click(centre);
    expect(tools.submit('abc')).toBe(false);
    expect(current().error).toBe('badInput');
    expect(current().active).toBe(true);
  });

  it('marks typed circles curved', () => {
    const { tools, solids } = setup();
    tools.setTool('circle');
    tools.click(centre);
    tools.submit('30');
    expect(solids[0].curved).toBe(true);
  });

  it('cancels the operation first and the tool second', () => {
    const { tools } = setup();
    tools.setTool('polygon');
    tools.click(centre);
    expect(tools.cancel()).toBe(true);
    expect(tools.tool).toBe('polygon');
    expect(tools.cancel()).toBe(true);
    expect(tools.tool).toBe('select');
    expect(tools.cancel()).toBe(false);
  });
});

describe('face mapping', () => {
  const floor = { walls: [{ id: 'w', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }] } as unknown as Floor;
  const wallHit = (normal: THREE.Vector3): FaceHit => {
    const object = new THREE.Mesh();
    object.userData.wallId = 'w';
    return { point: new THREE.Vector3(), normal, object, faceIndex: 0, corners: [] };
  };

  it('maps wall faces', () => {
    expect(pushTargetFromHit(wallHit(new THREE.Vector3(0, 1, 0)), floor)).toMatchObject({ kind: 'wall', id: 'w', face: 'top' });
    const front = pushTargetFromHit(wallHit(new THREE.Vector3(0, 0, 1)), floor);
    const back = pushTargetFromHit(wallHit(new THREE.Vector3(0, 0, -1)), floor);
    expect(front).toMatchObject({ kind: 'wall', face: 'side' });
    expect(back).toMatchObject({ kind: 'wall', face: 'side' });
    expect((front as { sign: number }).sign).toBe(-(back as { sign: number }).sign);
    expect(pushTargetFromHit(wallHit(new THREE.Vector3(1, 0, 0)), floor)).toBe('wallEnd');
  });

  it('maps a rotated cabinet face to its local axis', () => {
    const object = new THREE.Mesh();
    object.userData.cabinetId = 'c';
    object.rotation.y = Math.PI / 2;
    object.updateMatrixWorld();
    const hit: FaceHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(1, 0, 0), object, faceIndex: 0, corners: [] };
    expect(pushTargetFromHit(hit, floor)).toEqual({ kind: 'cabinet', id: 'c', axis: 'z', sign: 1 });
  });

  it('reports a missing target for unowned surfaces', () => {
    const hit: FaceHit = { point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), object: new THREE.Mesh(), faceIndex: 0, corners: [] };
    expect(pushTargetFromHit(hit, floor)).toBe('missing');
  });
});

describe('input helpers', () => {
  it('parses rectangle sizes', () => {
    expect(parseRectangleInput('120, 60', 'metric')).toEqual({ width: 120, depth: 60 });
    expect(parseRectangleInput('50', 'metric')).toEqual({ width: 50, depth: 50 });
    expect(parseRectangleInput('a, b', 'metric')).toBeNull();
    expect(parseRectangleInput('1,2,3', 'metric')).toBeNull();
  });

  it('measures along the push axis', () => {
    const ray = new THREE.Ray(new THREE.Vector3(100, 40, 0), new THREE.Vector3(-1, 0, 0));
    expect(pushDistance(ray, new THREE.Vector3(), new THREE.Vector3(0, 1, 0))).toBeCloseTo(40);
    const straightDown = new THREE.Ray(new THREE.Vector3(0, 100, 0), new THREE.Vector3(0, -1, 0));
    expect(pushDistance(straightDown, new THREE.Vector3(), new THREE.Vector3(0, 1, 0))).toBeNull();
  });
});
