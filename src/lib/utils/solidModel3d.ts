import * as THREE from 'three';
import type { Solid } from '$lib/models/types';
import { cabinetFinishTexture } from '$lib/utils/cabinetFinishes';
import { compensatedRoughness, TILE_SIZE_CM, type PbrSet } from '$lib/utils/pbrMaps';
import { solidMesh } from '$lib/utils/solids';

/** A drawn shape as one flat-shaded mesh in floor coordinates. `capTriangles` maps a hit triangle back to its face. */
export function createSolidModel(solid: Solid, textures?: (textureId: string) => PbrSet | null): THREE.Mesh {
  const { positions, uvs, capTriangles } = solidMesh(solid);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.map(value => value / TILE_SIZE_CM), 2));
  geometry.computeVertexNormals();

  const textureId = cabinetFinishTexture(solid);
  const pbr = textureId ? textures?.(textureId) ?? null : null;
  const surface = pbr
    ? { ...pbr, color: '#ffffff', roughness: compensatedRoughness(solid.roughness), metalness: solid.metalness }
    : { color: solid.color, roughness: solid.roughness, metalness: solid.metalness };
  const material = solid.transmission
    ? new THREE.MeshPhysicalMaterial({ ...surface, transmission: solid.transmission, ior: 1.5, thickness: solid.depth })
    : new THREE.MeshStandardMaterial(surface);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `solid:${solid.id}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.solidId = solid.id;
  mesh.userData.capTriangles = capTriangles;
  return mesh;
}
