import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Scene units are centimetres. Thickness is a view-depth cutoff, so it must span a wall seen at a grazing angle. */
const AO_RADIUS_CM = 40;
const AO_THICKNESS_CM = 200;
const BLOOM_STRENGTH = 0.25;
const BLOOM_RADIUS = 0.4;
/** Compared before tone mapping, so only surfaces brighter than diffuse white glow. */
const BLOOM_THRESHOLD = 1;

export type ViewCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

export interface ViewportEffects {
  readonly camera: ViewCamera;
  render(): void;
  dispose(): void;
}

/**
 * Ambient occlusion and bloom for the interactive view. GTAOPass fixes its projection type when
 * it is built, so a composer belongs to one camera and is rebuilt when the camera changes.
 */
export function createViewportEffects(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: ViewCamera): ViewportEffects {
  const size = renderer.getSize(new THREE.Vector2());
  const ratio = renderer.getPixelRatio();
  const target = new THREE.WebGLRenderTarget(size.x * ratio, size.y * ratio, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const ambientOcclusion = new GTAOPass(scene, camera, size.x, size.y);
  ambientOcclusion.updateGtaoMaterial({
    radius: AO_RADIUS_CM,
    distanceExponent: 1,
    thickness: AO_THICKNESS_CM,
    scale: 1.5,
    samples: 16,
    distanceFallOff: 0.2,
    screenSpaceRadius: false,
  });
  const passes = [
    new RenderPass(scene, camera),
    ambientOcclusion,
    new UnrealBloomPass(size.clone(), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD),
    new OutputPass(),
  ];
  for (const pass of passes) composer.addPass(pass);

  let width = -1;
  let height = -1;
  let pixelRatio = -1;
  const current = new THREE.Vector2();

  return {
    camera,
    render() {
      renderer.getSize(current);
      const nowRatio = renderer.getPixelRatio();
      if (current.x !== width || current.y !== height || nowRatio !== pixelRatio) {
        width = current.x;
        height = current.y;
        pixelRatio = nowRatio;
        composer.setPixelRatio(nowRatio);
        composer.setSize(width, height);
      }
      composer.render();
    },
    dispose() {
      for (const pass of passes) pass.dispose();
      composer.dispose();
    },
  };
}
