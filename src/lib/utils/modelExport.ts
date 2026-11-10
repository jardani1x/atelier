import * as THREE from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { collectTraceScene } from '$lib/utils/progressiveRender';

const METRES_PER_CM = 0.01;

/** Flattens the displayed model into one root scaled from plan centimetres to metres. */
export function buildExportRoot(source: THREE.Scene, exclude: ReadonlySet<THREE.Object3D> = new Set()): THREE.Group {
  const flat = collectTraceScene(source, exclude as Set<THREE.Object3D>);
  (flat.userData.ownedEnvironment as THREE.Texture | undefined)?.dispose();
  const root = new THREE.Group();
  root.name = 'atelier-model';
  root.scale.setScalar(METRES_PER_CM);
  for (const child of [...flat.children]) {
    if (child instanceof THREE.Mesh && !child.userData.xray) root.add(child);
  }
  root.updateMatrixWorld(true);
  return root;
}

export function modelToOBJ(root: THREE.Object3D): string {
  return new OBJExporter().parse(root);
}

export async function modelToGLB(root: THREE.Object3D): Promise<ArrayBuffer> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  return await new GLTFExporter().parseAsync(root, { binary: true }) as ArrayBuffer;
}

export function downloadModel(content: BlobPart, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
