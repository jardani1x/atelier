import { describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { frameScene } from '$lib/utils/frameScene';
import { parseLengthInput } from '$lib/stores/settings';

const box = new Box3(new Vector3(0, 0, 0), new Vector3(400, 260, 300));

function framed(view: 'front' | 'side' | 'iso') {
  const camera = new PerspectiveCamera(50, 1.5, 1, 20000);
  const target = new Vector3();
  frameScene(camera, box.clone(), target, { view });
  return camera.position.clone().sub(target).normalize();
}

describe('standard camera views', () => {
  it('looks along z for front and x for side', () => {
    expect(framed('front').z).toBeGreaterThan(0.99);
    expect(framed('side').x).toBeGreaterThan(0.99);
  });

  it('places the isometric view on the equal-axis diagonal', () => {
    const direction = framed('iso');
    expect(direction.x).toBeCloseTo(direction.y, 6);
    expect(direction.y).toBeCloseTo(direction.z, 6);
  });
});

describe('typed lengths', () => {
  it('reads 3500 mm as exactly 3.5 metres', () => {
    expect(parseLengthInput('3500 mm', 'metric')).toBe(350);
    expect(parseLengthInput('3500mm', 'metric')).toBe(350);
    expect(parseLengthInput('3.5 m', 'metric')).toBe(350);
  });
});
