import * as THREE from 'three';
import type { Floor, Point, Solid } from '$lib/models/types';
import { parseLengthInput } from '$lib/stores/settings';
import {
  circleProfile, faceOfTriangle, normalizeProfile, planeAxes, rectangleProfile, solidNormal, solidPoint,
  validProfile, wallSideNormal, type PushPullError, type PushPullTarget,
} from '$lib/utils/solids';

export type ModelTool = 'select' | 'rectangle' | 'circle' | 'polygon' | 'pushpull';
export type ModelToolError = PushPullError | 'badInput' | 'badShape' | 'wallEnd';

export interface ModelToolState {
  tool: ModelTool;
  /** True while an operation is waiting for its second click or typed value. */
  active: boolean;
  /** Live distance in centimetres. */
  readout: number | null;
  error: ModelToolError | null;
}

export interface ModelToolHost {
  camera(): THREE.Camera;
  root(): THREE.Object3D;
  scene(): THREE.Scene;
  floor(): Floor | null;
  units(): 'metric' | 'imperial';
  invalidate(): void;
  addSolid(solid: Omit<Solid, 'id'>): string;
  applyPushPull(target: PushPullTarget, distance: number): PushPullError | null;
  onState(state: ModelToolState): void;
}

export interface FaceHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  object: THREE.Object3D | null;
  faceIndex: number;
  corners: THREE.Vector3[];
}

interface DrawPlane { origin: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; normal: THREE.Vector3 }
interface PushOperation { target: PushPullTarget; anchor: THREE.Vector3; normal: THREE.Vector3; distance: number }

const SNAP_RADIUS = 6;
const HOVER_INTERVAL_MS = 40;
/** Thin enough to read as a drawn outline before the user pulls it out. */
const INITIAL_DEPTH = 1;
const DEFAULT_LOOK = { color: '#d9d4c7', roughness: 0.6, metalness: 0 };
const PREVIEW_COLOR = 0x2563eb;
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function ownerOf(object: THREE.Object3D | null, key: string): THREE.Object3D | null {
  for (let o = object; o; o = o.parent) if (typeof o.userData[key] === 'string') return o;
  return null;
}

function ownerId(object: THREE.Object3D | null, key: string): string | null {
  return ownerOf(object, key)?.userData[key] ?? null;
}

function shown(object: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function solidLooking(mesh: THREE.Mesh): boolean {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return !material?.transparent || material.opacity >= 0.5;
}

/** The first surface under the ray that a person can see and model on. */
export function pickFace(raycaster: THREE.Raycaster, root: THREE.Object3D): FaceHit | null {
  for (const hit of raycaster.intersectObject(root, true)) {
    const mesh = hit.object as THREE.Mesh;
    if (!mesh.isMesh || !hit.face || !shown(mesh) || mesh.userData.renderExclude || mesh.userData.ceilingOutline || !solidLooking(mesh)) continue;
    const normal = hit.face.normal.clone().transformDirection(mesh.matrixWorld);
    if (normal.dot(raycaster.ray.direction) > 0) normal.negate();
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const corners = [hit.face.a, hit.face.b, hit.face.c].map(i => new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
    return { point: hit.point.clone(), normal, object: mesh, faceIndex: hit.faceIndex ?? 0, corners };
  }
  const point = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(GROUND, point)) return null;
  return { point, normal: new THREE.Vector3(0, 1, 0), object: null, faceIndex: 0, corners: [] };
}

/** The element a click on an edit-mode model refers to, for selection. */
export function pickElementId(raycaster: THREE.Raycaster, root: THREE.Object3D): string | null {
  for (const hit of raycaster.intersectObject(root, true)) {
    if (!shown(hit.object)) continue;
    const id = ownerId(hit.object, 'wallId') ?? ownerId(hit.object, 'cabinetId') ?? ownerId(hit.object, 'solidId');
    if (id) return id;
  }
  return null;
}

/** Translates a picked face into the model edit a push/pull on it means. */
export function pushTargetFromHit(hit: FaceHit, floor: Floor): PushPullTarget | ModelToolError {
  const solid = ownerOf(hit.object, 'solidId');
  if (solid) return { kind: 'solid', id: solid.userData.solidId, face: faceOfTriangle(hit.faceIndex, solid.userData.capTriangles) };
  const cabinet = ownerOf(hit.object, 'cabinetId');
  if (cabinet) {
    let group = cabinet;
    while (group.parent && typeof group.parent.userData.cabinetId === 'string') group = group.parent;
    const local = hit.normal.clone().applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()).invert());
    const magnitudes = [Math.abs(local.x), Math.abs(local.y), Math.abs(local.z)];
    const axis = (['x', 'y', 'z'] as const)[magnitudes.indexOf(Math.max(...magnitudes))];
    return { kind: 'cabinet', id: cabinet.userData.cabinetId, axis, sign: local[axis] >= 0 ? 1 : -1 };
  }
  const wallId = ownerId(hit.object, 'wallId');
  const wall = wallId ? floor.walls.find(w => w.id === wallId) : null;
  if (!wall) return 'missing';
  if (hit.normal.y > 0.7) return { kind: 'wall', id: wall.id, face: 'top', sign: 1 };
  const side = wallSideNormal(wall);
  const facing = hit.normal.x * side.x + hit.normal.z * side.y;
  if (Math.abs(facing) < 0.7) return 'wallEnd';
  return { kind: 'wall', id: wall.id, face: 'side', sign: facing > 0 ? 1 : -1 };
}

/** Distance along the push axis that sits closest to the mouse ray; null when looking straight down the axis. */
export function pushDistance(ray: THREE.Ray, anchor: THREE.Vector3, normal: THREE.Vector3): number | null {
  const offset = anchor.clone().sub(ray.origin);
  const b = normal.dot(ray.direction);
  const denominator = 1 - b * b;
  if (denominator < 1e-3) return null;
  return (b * ray.direction.dot(offset) - normal.dot(offset)) / denominator;
}

/** Reads "120, 60" or "120" (a square) as width and depth. */
export function parseRectangleInput(text: string, units: 'metric' | 'imperial'): { width: number; depth: number } | null {
  const parts = text.split(/[,;]/).map(part => part.trim());
  if (parts.length > 2 || parts.some(part => !part)) return null;
  const width = parseLengthInput(parts[0], units);
  const depth = parts.length === 2 ? parseLengthInput(parts[1], units) : width;
  return width && depth ? { width, depth } : null;
}

export function createModelingTools(host: ModelToolHost) {
  const raycaster = new THREE.Raycaster();
  const preview = new THREE.Group();
  preview.name = 'modeling-preview';
  preview.userData.renderExclude = true;
  let tool: ModelTool = 'select';
  let error: ModelToolError | null = null;
  let plane: DrawPlane | null = null;
  let points: Point[] = [];
  let cursor: Point | null = null;
  let push: PushOperation | null = null;
  let hover: FaceHit | null = null;
  let lastHover = 0;

  const active = () => !!plane || !!push;

  function publish() {
    let readout: number | null = null;
    if (push) readout = push.distance;
    else if (plane && cursor && points.length) readout = Math.hypot(cursor.x - points[points.length - 1].x, cursor.y - points[points.length - 1].y);
    host.onState({ tool, active: active(), readout, error });
  }

  function clearPreview() {
    for (const child of [...preview.children]) {
      preview.remove(child);
      (child as THREE.Line).geometry?.dispose();
      ((child as THREE.Line).material as THREE.Material)?.dispose();
    }
  }

  function overlay(object: THREE.Line | THREE.Points) {
    (object.material as THREE.Material).depthTest = false;
    object.userData.renderExclude = true;
    object.renderOrder = 999;
    object.frustumCulled = false;
    preview.add(object);
  }

  function line(vertices: THREE.Vector3[], closed: boolean) {
    const geometry = new THREE.BufferGeometry().setFromPoints(vertices);
    const material = new THREE.LineBasicMaterial({ color: PREVIEW_COLOR });
    overlay(closed ? new THREE.LineLoop(geometry, material) : new THREE.Line(geometry, material));
  }

  function dot(position: THREE.Vector3) {
    overlay(new THREE.Points(new THREE.BufferGeometry().setFromPoints([position]), new THREE.PointsMaterial({ color: PREVIEW_COLOR, size: 9, sizeAttenuation: false })));
  }

  const onPlane = (p: Point) => plane!.origin.clone().addScaledVector(plane!.u, p.x).addScaledVector(plane!.v, p.y);

  function snapToCorner(hit: FaceHit): THREE.Vector3 {
    let best = hit.point;
    let bestDistance = SNAP_RADIUS;
    for (const corner of hit.corners) {
      const distance = corner.distanceTo(hit.point);
      if (distance < bestDistance) { best = corner; bestDistance = distance; }
    }
    return best.clone();
  }

  function draftProfile(): { points: Point[]; closed: boolean } {
    if (!plane || !cursor) return { points, closed: false };
    if (tool === 'rectangle') return { points: rectangleProfile({ x: 0, y: 0 }, cursor), closed: true };
    if (tool === 'circle') return { points: circleProfile({ x: 0, y: 0 }, Math.max(0.01, Math.hypot(cursor.x, cursor.y))), closed: true };
    return { points: [...points, cursor], closed: false };
  }

  function redraw() {
    clearPreview();
    if (push) {
      const end = push.anchor.clone().addScaledVector(push.normal, push.distance);
      line([push.anchor, end], false);
      dot(end);
    } else if (plane) {
      const draft = draftProfile();
      if (draft.points.length > 1) line(draft.points.map(onPlane), draft.closed);
      dot(plane.origin);
    } else if (hover && tool !== 'select') {
      dot(snapToCorner(hover));
    }
    host.invalidate();
  }

  function planePoint(): Point | null {
    if (!plane) return null;
    const world = raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(plane.normal, plane.origin), new THREE.Vector3());
    if (!world) return null;
    const offset = world.sub(plane.origin);
    return { x: Math.round(offset.dot(plane.u)), y: Math.round(offset.dot(plane.v)) };
  }

  const closeRadius = () => Math.max(3, host.camera().position.distanceTo(plane!.origin) * 0.015);

  function lockPolygonAxis(p: Point): Point {
    const last = points[points.length - 1];
    if (tool !== 'polygon' || !last) return p;
    const lock = closeRadius() / 2;
    return { x: Math.abs(p.x - last.x) < lock ? last.x : p.x, y: Math.abs(p.y - last.y) < lock ? last.y : p.y };
  }

  function resetOperation() {
    plane = null;
    points = [];
    cursor = null;
    push = null;
  }

  function fail(reason: ModelToolError) {
    error = reason;
    publish();
    return false;
  }

  function startPlane(hit: FaceHit) {
    const axes = planeAxes(hit.normal);
    plane = {
      origin: snapToCorner(hit),
      u: new THREE.Vector3(axes.u.x, axes.u.y, axes.u.z),
      v: new THREE.Vector3(axes.v.x, axes.v.y, axes.v.z),
      normal: hit.normal.clone(),
    };
    points = [{ x: 0, y: 0 }];
    cursor = null;
  }

  /** Commits the outline and hands it to push/pull, so drawing flows into giving it depth. */
  function finishShape(profile: Point[], curved: boolean): boolean {
    const outline = normalizeProfile(profile);
    if (!plane || !validProfile(outline)) return fail('badShape');
    const root = host.root().position;
    const shape: Omit<Solid, 'id'> = {
      // Stored relative to the floor's model root; the plane itself is in world space.
      origin: { x: plane.origin.x - root.x, y: plane.origin.y - root.y, z: plane.origin.z - root.z },
      u: { x: plane.u.x, y: plane.u.y, z: plane.u.z },
      v: { x: plane.v.x, y: plane.v.y, z: plane.v.z },
      profile: outline,
      depth: INITIAL_DEPTH,
      ...DEFAULT_LOOK,
      ...(curved ? { curved: true } : {}),
    };
    const id = host.addSolid(shape);
    const normal = solidNormal(shape);
    const centre = outline.reduce((sum, p) => ({ x: sum.x + p.x / outline.length, y: sum.y + p.y / outline.length }), { x: 0, y: 0 });
    const top = solidPoint(shape, centre, INITIAL_DEPTH);
    resetOperation();
    tool = 'pushpull';
    push = { target: { kind: 'solid', id, face: 'top' }, anchor: new THREE.Vector3(top.x, top.y, top.z).add(root), normal: new THREE.Vector3(normal.x, normal.y, normal.z), distance: 0 };
    error = null;
    return true;
  }

  function commitPush(distance: number): boolean {
    if (!push) return false;
    if (distance !== 0) {
      const reason = host.applyPushPull(push.target, distance);
      if (reason) return fail(reason);
    }
    push = null;
    error = null;
    return true;
  }

  function closePolygon(): boolean {
    return points.length < 3 ? fail('badShape') : finishShape(points, false);
  }

  function clickDrawing(hit: FaceHit | null): void {
    if (!plane) {
      if (hit) startPlane(hit);
      return;
    }
    const p = planePoint();
    if (!p) return;
    if (tool === 'rectangle') {
      if (p.x === 0 || p.y === 0) fail('badShape');
      else finishShape(rectangleProfile({ x: 0, y: 0 }, p), false);
    } else if (tool === 'circle') {
      const radius = Math.hypot(p.x, p.y);
      if (radius > 0) finishShape(circleProfile({ x: 0, y: 0 }, radius), true);
      else fail('badShape');
    } else if (points.length >= 3 && Math.hypot(p.x, p.y) <= closeRadius()) {
      closePolygon();
    } else {
      points = [...points, lockPolygonAxis(p)];
    }
  }

  function clickPush(hit: FaceHit | null): void {
    if (push) { commitPush(push.distance); return; }
    const floor = host.floor();
    if (!hit?.object || !floor) { fail('missing'); return; }
    const target = pushTargetFromHit(hit, floor);
    if (typeof target === 'string') { fail(target); return; }
    push = { target, anchor: hit.point.clone(), normal: hit.normal.clone(), distance: 0 };
  }

  function typed(text: string): boolean {
    const value = text.trim();
    const units = host.units();
    if (push) {
      const distance = parseLengthInput(value, units);
      return distance === null ? fail('badInput') : commitPush(distance);
    }
    if (!plane) return fail('badInput');
    if (tool === 'polygon' && !value) return closePolygon();
    if (tool === 'rectangle') {
      const size = parseRectangleInput(value, units);
      if (!size) return fail('badInput');
      const width = Math.abs(size.width) * (cursor && cursor.x < 0 ? -1 : 1);
      const depth = Math.abs(size.depth) * (cursor && cursor.y < 0 ? -1 : 1);
      return finishShape(rectangleProfile({ x: 0, y: 0 }, { x: width, y: depth }), false);
    }
    const length = parseLengthInput(value, units);
    if (!length || length <= 0) return fail('badInput');
    if (tool === 'circle') return finishShape(circleProfile({ x: 0, y: 0 }, length), true);
    const last = points[points.length - 1];
    const dx = (cursor?.x ?? last.x + 1) - last.x, dy = (cursor?.y ?? last.y) - last.y;
    const span = Math.hypot(dx, dy);
    if (!span) return fail('badInput');
    points = [...points, { x: last.x + (dx / span) * length, y: last.y + (dy / span) * length }];
    return true;
  }

  function setTool(next: ModelTool) {
    resetOperation();
    hover = null;
    tool = next;
    error = null;
    if (next === 'select') preview.removeFromParent();
    else if (!preview.parent) host.scene().add(preview);
    redraw();
    publish();
  }

  return {
    get tool() { return tool; },
    setTool,
    pointerMove(ndc: THREE.Vector2, now = performance.now()) {
      if (tool === 'select') return;
      raycaster.setFromCamera(ndc, host.camera());
      if (push) {
        const distance = pushDistance(raycaster.ray, push.anchor, push.normal);
        if (distance !== null) push.distance = Math.round(distance * 2) / 2;
      } else if (plane) {
        const p = planePoint();
        if (p) cursor = lockPolygonAxis(p);
      } else {
        if (now - lastHover < HOVER_INTERVAL_MS) return;
        lastHover = now;
        hover = pickFace(raycaster, host.root());
      }
      redraw();
      publish();
    },
    click(ndc: THREE.Vector2) {
      if (tool === 'select') return;
      raycaster.setFromCamera(ndc, host.camera());
      error = null;
      const hit = !plane && !push ? pickFace(raycaster, host.root()) : null;
      if (tool === 'pushpull') clickPush(hit);
      else clickDrawing(hit);
      redraw();
      publish();
    },
    /** Applies a typed value. Returns true when the field should clear. */
    submit(text: string): boolean {
      error = null;
      const done = typed(text);
      redraw();
      publish();
      return done;
    },
    /** Steps back one level. Returns false when nothing was left to cancel. */
    cancel(): boolean {
      if (active()) {
        resetOperation();
        error = null;
        redraw();
        publish();
        return true;
      }
      if (tool !== 'select') {
        setTool('select');
        return true;
      }
      return false;
    },
    dispose() {
      clearPreview();
      preview.removeFromParent();
    },
  };
}

export type ModelingTools = ReturnType<typeof createModelingTools>;
