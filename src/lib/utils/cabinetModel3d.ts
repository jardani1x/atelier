import * as THREE from 'three';
import type { Cabinet } from '$lib/models/types';
import { cabinetPanels } from '$lib/utils/cabinetGeometry';
import { cabinetFinishTexture } from '$lib/utils/cabinetFinishes';
import { applyPlanarBoxUvs, compensatedRoughness, type PbrSet } from '$lib/utils/pbrMaps';

/** Visual gap around door leaves so adjoining doors read as separate panels. */
const DOOR_REVEAL = 0.3;

/** Builds real solid panels; plan (x, y) maps to world (x, 0, y), matching walls and furniture.
 * `textures` resolves a finish photo; it may return null while the image is still loading. */
export function createCabinetModel(cabinet: Cabinet, textures?: (textureId: string) => PbrSet | null): THREE.Group {
  const group = new THREE.Group();
  group.name = `cabinet:${cabinet.id}`;
  group.position.set(cabinet.position.x, cabinet.elevation ?? 0, cabinet.position.y);
  group.rotation.y = (-cabinet.rotation * Math.PI) / 180;
  group.userData.cabinetId = cabinet.id;

  const textureId = cabinetFinishTexture(cabinet);
  const pbr = textureId ? textures?.(textureId) ?? null : null;
  const surface = pbr
    ? { ...pbr, color: '#ffffff', roughness: compensatedRoughness(cabinet.roughness), metalness: cabinet.metalness }
    : { color: cabinet.color, roughness: cabinet.roughness, metalness: cabinet.metalness };
  const material = cabinet.transmission
    ? new THREE.MeshPhysicalMaterial({ ...surface, transmission: cabinet.transmission, ior: 1.5, thickness: cabinet.thickness })
    : new THREE.MeshStandardMaterial(surface);
  for (const panel of cabinetPanels(cabinet)) {
    const reveal = panel.role === 'door' ? DOOR_REVEAL : 0;
    const geometry = new THREE.BoxGeometry(panel.size.x - reveal, panel.size.y - reveal, panel.size.z);
    if (pbr) applyPlanarBoxUvs(geometry, panel.center);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(panel.center.x, panel.center.y, panel.center.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.cabinetId = cabinet.id;
    mesh.userData.cabinetRole = panel.role;
    group.add(mesh);
  }
  return group;
}
