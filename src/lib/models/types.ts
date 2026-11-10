import type { CabinetParams } from '$lib/utils/cabinetGeometry';

export interface Point { x: number; y: number; }

/** Shared item metadata. Null explicitly clears a retained native value. */
export interface ItemDetails {
  note?: string | null;
  price?: number | null;
  photos?: string[];
  material?: string | null;
  roomType?: string | null;
  ceilingHeight?: number | null; // centimetres; metadata, not a wall-height edit
}
export type DetailKind = 'walls' | 'doors' | 'windows' | 'furniture' | 'rooms';
export type DetailTarget = { floorId: string; kind: DetailKind; id: string };
export type PackageMapping = { id: string; kind: string; webId: string; floorId?: string }[];
export interface ProjectPackageState {
  version: 1;
  furnitureCategoriesVersion?: 1;
  native: Record<string, any>;
  mapping: PackageMapping;
  assets: Record<string, string>; // assets/<filename> → base64 bytes, one copy per file
}

export interface Wall {
  details?: ItemDetails;
  id: string;
  start: Point;
  end: Point;
  thickness: number;
  height: number;
  /** Endpoint heights in centimetres. Missing values use the legacy height. */
  startHeight?: number;
  endHeight?: number;
  color: string;
  /** Optional quadratic bezier control point for curved walls */
  curvePoint?: Point;
  texture?: string;
  /** Interior-specific overrides (if different from exterior) */
  interiorColor?: string;
  interiorTexture?: string;
  /** Exterior-specific overrides */
  exteriorColor?: string;
  exteriorTexture?: string;
}

export function validWallHeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function getWallStartHeight(wall: Wall): number {
  return validWallHeight(wall.startHeight) ? wall.startHeight : validWallHeight(wall.height) ? wall.height : 280;
}

export function getWallEndHeight(wall: Wall): number {
  return validWallHeight(wall.endHeight) ? wall.endHeight : validWallHeight(wall.height) ? wall.height : 280;
}

export function getWallHeightAt(wall: Wall, t: number): number {
  const s = getWallStartHeight(wall);
  const e = getWallEndHeight(wall);
  const clampedT = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  return s + (e - s) * clampedT;
}


export type RoomCategory = 'indoor' | 'outdoor' | 'garage' | 'utility';

export interface Room {
  /** Enclosed opening through this floor's slab; excluded from usable floor area. */
  floorOpening?: boolean;
  details?: ItemDetails;
  id: string;
  name: string;
  walls: string[];
  floorTexture: string;
  area: number;
  color?: string;
  roomType?: RoomCategory;
  /** Custom label position offset from centroid (in world units) */
  labelOffset?: Point;
}

export interface Door {
  details?: ItemDetails;
  id: string;
  wallId: string;
  position: number; // 0-1 along wall
  width: number;
  height: number;
  type: 'single' | 'double' | 'sliding' | 'french' | 'pocket' | 'bifold' | 'opening' | 'garage';
  swingDirection: 'left' | 'right';
  flipSide: boolean; // flip which side of wall the door opens to (vertical flip)
}

export interface Window {
  details?: ItemDetails;
  id: string;
  wallId: string;
  position: number; // 0-1 along wall
  width: number;
  height: number;
  sillHeight: number;
  type: 'standard' | 'fixed' | 'casement' | 'sliding' | 'bay';
}

export interface FurnitureItem {
  /** Project-owned model; catalogId remains a portable procedural fallback. */
  customModelId?: string;
  details?: ItemDetails;
  id: string;
  catalogId: string;
  /** Original unsupported import category, used only by the imported_object preview. */
  sourceCategory?: string;
  position: Point;
  rotation: number;
  scale: { x: number; y: number; z: number };
  // Per-item overrides (optional — falls back to catalog defaults)
  color?: string;
  width?: number;   // cm
  depth?: number;   // cm
  height?: number;  // cm
  material?: string; // material name/id
  locked?: boolean;
}

export interface ElementGroup {
  id: string;
  elementIds: string[];
}

export type StairType = 'straight' | 'l-shaped' | 'u-shaped' | 'spiral';

export interface Stair {
  id: string;
  position: Point;
  rotation: number;
  width: number;   // default 100cm
  depth: number;   // default 300cm
  riserCount: number; // default 14
  direction: 'up' | 'down';
  stairType: StairType; // default 'straight'
}

export interface Column {
  id: string;
  position: Point;
  rotation: number;
  shape: 'round' | 'square';
  diameter: number;  // cm (for round) or side length (for square)
  height: number;    // cm
  color: string;
}

/** A parametric built-in. Dimensions are cm; `position` is the footprint centre; the front faces local +y in plan. */
export interface Cabinet extends CabinetParams {
  id: string;
  name?: string;
  position: Point;
  rotation: number;
  color: string;
  roughness: number;
  metalness: number;
  /** 0 to 1; absent means opaque. */
  transmission?: number;
  /** Height of the cabinet base above the floor in cm; absent means floor level. */
  elevation?: number;
  locked?: boolean;
}

export interface Measurement {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Annotation {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  offset: number; // perpendicular offset for dimension line (default 40)
}

export interface TextAnnotation {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
  rotation: number;
}

export interface GuideLine {
  id: string;
  orientation: 'horizontal' | 'vertical';
  position: number; // world coordinate (x for vertical, y for horizontal)
}

export interface BackgroundImage {
  dataUrl: string;
  position: Point;
  scale: number;
  opacity: number;
  rotation: number;
  locked: boolean;
}

/** A placed 2D entourage symbol (person, car, tree, …) for presentation plans */
export interface EntourageItem {
  id: string;
  defId: string; // id of a built-in EntourageDef or a project CustomEntourageDef
  position: Point; // center, world cm
  width: number; // real-world width in cm
  rotation: number; // degrees
  opacity?: number; // 0–1, default 1
  locked?: boolean;
}

/** User-uploaded PNG entourage symbol, stored on the project */
export interface CustomEntourageDef {
  id: string;
  name: string;
  dataUrl: string; // PNG as data URL
  aspect: number; // height / width
}

export interface SolidVector {
  x: number;
  y: number;
  z: number;
}

/** A polygon drawn on any plane and extruded along that plane's normal. Coordinates are 3D, in cm, relative to the floor. */
export interface Solid {
  id: string;
  name?: string;
  origin: SolidVector;
  /** Unit in-plane axes; u x v is the extrusion direction. */
  u: SolidVector;
  v: SolidVector;
  /** Counter-clockwise outline in (u, v) coordinates. */
  profile: Point[];
  depth: number;
  /** The profile approximates a circle, so a side push changes the radius. */
  curved?: boolean;
  color: string;
  roughness: number;
  metalness: number;
  transmission?: number;
  locked?: boolean;
}

export interface Floor {
  id: string;
  name: string;
  level: number;
  /** Floor surface above ground in cm; omitted in legacy projects (level × 300). */
  elevation?: number;
  /** Room slab depth below the floor surface in cm; defaults to 5. */
  slabThickness?: number;
  walls: Wall[];
  rooms: Room[];
  doors: Door[];
  windows: Window[];
  furniture: FurnitureItem[];
  stairs: Stair[];
  columns: Column[];
  cabinets?: Cabinet[];
  solids?: Solid[];
  backgroundImage?: BackgroundImage;
  guides: GuideLine[];
  measurements: Measurement[];
  annotations: Annotation[];
  textAnnotations: TextAnnotation[];
  groups: ElementGroup[];
  entourage?: EntourageItem[];
}

export interface CustomModelDef {
  id: string;
  name: string;
  assetName: string; // filename within projectPackage.assets, without assets/
  sourceFilename: string;
  sha256: string; // digest of original GLB bytes, checked again before loading
  byteLength: number;
  width: number; // cm
  depth: number; // cm
  height: number; // cm
  attribution?: string;
  license?: string;
  sourceUrl?: string;
}

/** Sibling planner blocks retained through import and export. Apple capture keys never qualify. */
export const INTERCHANGE_BLOCK_KEYS = ['openkitchen3d', 'openlandscape3d', 'opencatio3d'] as const;
export type InterchangeBlockKey = typeof INTERCHANGE_BLOCK_KEYS[number];

/** Prepared-RoomPlan data the web model cannot hold; utils/interchange.ts re-emits it verbatim. */
export interface InterchangeState {
  version: 1;
  /** Top-level sibling blocks exactly as imported, keyed by INTERCHANGE_BLOCK_KEYS. */
  blocks: Record<string, unknown>;
  /** Object identifier → that object's `attributes` (openkitchen3dRole, sku, plantId, opencatio3dKind, …). */
  attributes?: Record<string, Record<string, unknown>>;
  /** The file's top-level `defaults` object. */
  defaults?: Record<string, unknown>;
  /** The file's top-level `planNotes`. */
  planNotes?: string;
}

/** A named camera position in the 3D view, in scene centimetres. */
export interface SavedView {
  id: string;
  name: string;
  position: SolidVector;
  target: SolidVector;
  floorId?: string;
}

export interface Project {
  savedViews?: SavedView[];
  customModels?: CustomModelDef[];
  attachmentNames?: Record<string, string>;
  projectPackage?: ProjectPackageState;
  interchange?: InterchangeState;
  id: string;
  name: string;
  description?: string;
  floors: Floor[];
  activeFloorId: string;
  createdAt: Date;
  updatedAt: Date;
  customEntourage?: CustomEntourageDef[];
}
