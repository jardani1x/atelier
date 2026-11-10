import * as THREE from 'three';
import { kelvinToRgb, layoutCeilingLights, viewpointInsideRoom, type CeilingOutline, type PlanPoint } from './ceilingLights';
import { DEFAULT_LIGHT_INTENSITY, DEFAULT_LIGHT_TEMPERATURE, denoiseSigma, denoiseThreshold } from './renderSettings';

/** omit: open-topped model. reflect: faces the room only, so the sky still reaches it. solid: also blocks the sky, for views from inside. */
export type TraceCeilings = 'omit' | 'reflect' | 'solid';

export interface PathTrace {
  readonly samples: number;
  readonly meshCount: number;
  readonly cabinetPanels: number;
  /** Interior fittings added to the trace. */
  readonly interiorLights: number;
  cameraMoved(): boolean;
  /** True once the camera has crossed a room boundary, which changes how ceilings must be traced. */
  viewChangedRoomState(): boolean;
  renderSample(): void;
  setDenoise(enabled: boolean): void;
  dispose(): void;
}

export interface PathTraceOptions {
  bounces?: number;
  tiles?: number;
  renderScale?: number;
  /** Replaces the viewer's sky and lights. The trace takes ownership and disposes it. */
  environment?: THREE.Texture;
  interiorLight?: boolean;
  lightTemperature?: number;
  lightIntensity?: number;
  denoise?: boolean;
}

const FITTING_SIZE_CM = 40;
/** Radiance chosen by eye so a 2 m grid of fittings lights a room at exposure 1. */
const FITTING_RADIANCE = 60;

/** Square panels under each ceiling. With no ceilings, one light at ceiling height, scaled to the model's size in cm. */
function addInteriorLights(scene: THREE.Scene, options: PathTraceOptions): number {
  const [r, g, b] = kelvinToRgb(options.lightTemperature ?? DEFAULT_LIGHT_TEMPERATURE);
  // A camera white-balances towards its light, so only half of the fitting's tint reaches the image.
  const colour = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace).lerp(new THREE.Color(1, 1, 1), 0.5);
  const intensity = options.lightIntensity ?? DEFAULT_LIGHT_INTENSITY;
  const positions = layoutCeilingLights((scene.userData.ceilings ?? []) as CeilingOutline[]);
  for (const position of positions) {
    const light = new THREE.RectAreaLight(colour, FITTING_RADIANCE * intensity, FITTING_SIZE_CM, FITTING_SIZE_CM);
    light.position.set(position.x, position.y, position.z);
    light.rotation.x = -Math.PI / 2; // RectAreaLight emits along -Z, which this turns to face the floor.
    scene.add(light);
  }
  if (!positions.length) {
    const bounds = new THREE.Box3().setFromObject(scene);
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    const reach = Math.max(size.x, size.z) / 2;
    const light = new THREE.PointLight(colour, 6 * reach * reach * intensity, 0, 2);
    light.position.set(centre.x, bounds.min.y + size.y * 0.9, centre.z);
    scene.add(light);
  }
  scene.updateMatrixWorld(true);
  return positions.length || 1;
}

function copyLight(light: THREE.Light, target: THREE.Scene) {
  const copy = light.clone(false) as THREE.Light;
  copy.position.setFromMatrixPosition(light.matrixWorld);
  target.add(copy);
  if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) {
    const aim = (copy as THREE.DirectionalLight).target;
    aim.position.setFromMatrixPosition(light.target.matrixWorld);
    target.add(aim);
  }
}

/** The tracer builds its light-sampling tables from CPU pixels, so a canvas sky needs a linear data copy. */
function readableEnvironment(texture: THREE.Texture): THREE.Texture | null {
  if ((texture.image as { data?: unknown } | null)?.data) return texture;
  const canvas = texture.image as HTMLCanvasElement | null;
  const context = canvas?.getContext?.('2d');
  if (!canvas || !context) return null;
  const { width, height } = canvas;
  const rgba = context.getImageData(0, 0, width, height).data;
  const pixels = new Uint16Array(width * height * 4);
  const colour = new THREE.Color();
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let y = 0; y < height; y++) {
    const sourceRow = (height - 1 - y) * width * 4;
    for (let x = 0; x < width; x++) {
      const from = sourceRow + x * 4;
      const to = (y * width + x) * 4;
      colour.setRGB(rgba[from] / 255, rgba[from + 1] / 255, rgba[from + 2] / 255, THREE.SRGBColorSpace);
      pixels[to] = THREE.DataUtils.toHalfFloat(colour.r);
      pixels[to + 1] = THREE.DataUtils.toHalfFloat(colour.g);
      pixels[to + 2] = THREE.DataUtils.toHalfFloat(colour.b);
      pixels[to + 3] = one;
    }
  }
  const environment = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  environment.mapping = THREE.EquirectangularReflectionMapping;
  environment.colorSpace = THREE.LinearSRGBColorSpace;
  environment.minFilter = environment.magFilter = THREE.LinearFilter;
  environment.needsUpdate = true;
  return environment;
}

/**
 * The tracer numbers materials per entry of a mesh's material array but per mesh when merging geometry,
 * so one multi-material mesh would shift the material of every mesh after it. One material per mesh avoids that.
 */
function splitByMaterial(geometry: THREE.BufferGeometry, materials: THREE.Material[]): [THREE.BufferGeometry, THREE.Material][] {
  const index = geometry.index;
  const total = index ? index.count : geometry.getAttribute('position').count;
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: total, materialIndex: 0 }];
  const parts: [THREE.BufferGeometry, THREE.Material][] = [];
  for (const group of groups) {
    const material = materials[group.materialIndex ?? 0];
    if (!material) continue;
    const part = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) part.setAttribute(name, attribute);
    const count = Math.min(group.count, total - group.start);
    part.setIndex(Array.from({ length: count }, (_, i) => index ? index.getX(group.start + i) : group.start + i));
    parts.push([part, material]);
  }
  return parts;
}

/** Flattens what the viewer displays into a scene for tracing. Geometry and materials are shared, not copied. */
export function collectTraceScene(
  source: THREE.Scene,
  exclude: ReadonlySet<THREE.Object3D> = new Set(),
  environment?: THREE.Texture,
  ceilingMode: TraceCeilings = 'omit',
): THREE.Scene {
  source.updateMatrixWorld(true);
  const target = new THREE.Scene();
  const ceilings: CeilingOutline[] = [];
  target.userData.ceilings = ceilings;
  const ownedMaterials: THREE.Material[] = [];
  target.userData.ownedMaterials = ownedMaterials;
  if (environment) {
    target.environment = environment;
    target.background = environment;
    target.userData.ownedEnvironment = environment;
  } else {
    const sky = source.background instanceof THREE.Texture ? source.background : null;
    const lighting = source.environment ?? sky;
    target.environment = lighting && readableEnvironment(lighting);
    target.background = sky === lighting && target.environment ? target.environment : source.background;
    if (target.environment && target.environment !== lighting) target.userData.ownedEnvironment = target.environment;
  }
  const visit = (node: THREE.Object3D) => {
    if (!node.visible || exclude.has(node)) return;
    const outline = node.userData.ceilingOutline as PlanPoint[] | undefined;
    if (outline) ceilings.push({ outline, height: new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).y });
    if (node.userData.renderExclude === true && !(outline && ceilingMode !== 'omit')) return;
    if (node instanceof THREE.Mesh) {
      let material = node.material as THREE.Material;
      if (outline && ceilingMode === 'solid') {
        material = material.clone();
        material.side = THREE.DoubleSide;
        ownedMaterials.push(material);
      }
      const parts: [THREE.BufferGeometry, THREE.Material][] = Array.isArray(node.material)
        ? splitByMaterial(node.geometry, node.material)
        : [[node.geometry, material]];
      for (const [geometry, partMaterial] of parts) {
        const copy = new THREE.Mesh(geometry, partMaterial);
        copy.matrixAutoUpdate = false;
        copy.matrix.copy(node.matrixWorld);
        copy.userData = { ...node.userData };
        target.add(copy);
      }
    } else if (!environment && (node instanceof THREE.DirectionalLight || node instanceof THREE.PointLight || node instanceof THREE.SpotLight)) {
      copyLight(node, target);
    }
    for (const child of node.children) visit(child);
  };
  for (const child of source.children) visit(child);
  target.updateMatrixWorld(true);
  return target;
}

/** Throws if the device cannot compile the tracer; the caller keeps the rasterised view. */
export async function createPathTrace(
  renderer: THREE.WebGLRenderer,
  source: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  exclude: ReadonlySet<THREE.Object3D> = new Set(),
  options: PathTraceOptions = {},
): Promise<PathTrace> {
  const { WebGLPathTracer, DenoiseMaterial } = await import('three-gpu-pathtracer');
  const outlines: CeilingOutline[] = [];
  source.updateMatrixWorld(true);
  source.traverseVisible((node) => {
    const outline = node.userData.ceilingOutline as PlanPoint[] | undefined;
    if (outline) outlines.push({ outline, height: new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).y });
  });
  const cameraInside = () => viewpointInsideRoom(new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld), outlines);
  camera.updateMatrixWorld(true);
  const startedInside = cameraInside();
  const ceilingMode: TraceCeilings = startedInside ? 'solid' : options.interiorLight ? 'reflect' : 'omit';
  const scene = collectTraceScene(source, exclude, options.environment, ceilingMode);
  const meshes = scene.children.filter((node) => node instanceof THREE.Mesh);
  if (!meshes.length) {
    options.environment?.dispose();
    throw new Error('There is no displayed geometry to trace.');
  }
  const interiorLights = options.interiorLight ? addInteriorLights(scene, options) : 0;
  const tracer = new WebGLPathTracer(renderer);
  const denoiser = new DenoiseMaterial({ premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha });
  let denoise = options.denoise ?? false;
  tracer.renderToCanvasCallback = (target, canvasRenderer, quad) => {
    const plain = quad.material;
    if (denoise) {
      denoiser.map = target.texture;
      denoiser.sigma = denoiseSigma(tracer.samples);
      denoiser.threshold = denoiseThreshold(tracer.samples);
      denoiser.opacity = (plain as THREE.Material).opacity;
      quad.material = denoiser;
    }
    const autoClear = canvasRenderer.autoClear;
    canvasRenderer.autoClear = false;
    quad.render(canvasRenderer);
    canvasRenderer.autoClear = autoClear;
    quad.material = plain;
  };
  const release = () => {
    tracer.dispose();
    denoiser.dispose();
    for (const material of scene.userData.ownedMaterials as THREE.Material[]) material.dispose();
    (scene.userData.ownedEnvironment as THREE.Texture | undefined)?.dispose();
  };
  try {
    tracer.bounces = options.bounces ?? 6;
    tracer.filterGlossyFactor = 0.5;
    tracer.tiles.set(options.tiles ?? 3, options.tiles ?? 3);
    tracer.renderScale = options.renderScale ?? 1;
    tracer.renderDelay = 0;
    tracer.minSamples = 1;
    tracer.fadeDuration = 0;
    tracer.textureSize.set(1024, 1024);
    camera.updateMatrixWorld(true);
    tracer.setScene(scene, camera);
  } catch (error) {
    release();
    throw error;
  }
  const lastCamera = camera.matrixWorld.clone();
  const lastProjection = camera.projectionMatrix.clone();
  return {
    get samples() { return tracer.samples; },
    meshCount: meshes.length,
    cabinetPanels: meshes.filter((mesh) => mesh.userData.cabinetRole).length,
    interiorLights,
    setDenoise(enabled) { denoise = enabled; },
    cameraMoved: () => !lastCamera.equals(camera.matrixWorld) || !lastProjection.equals(camera.projectionMatrix),
    viewChangedRoomState: () => cameraInside() !== startedInside,
    renderSample() {
      if (!lastCamera.equals(camera.matrixWorld) || !lastProjection.equals(camera.projectionMatrix)) {
        lastCamera.copy(camera.matrixWorld);
        lastProjection.copy(camera.projectionMatrix);
        tracer.updateCamera();
      }
      tracer.renderSample();
    },
    dispose: release,
  };
}
