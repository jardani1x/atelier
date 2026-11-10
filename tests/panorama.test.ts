import { describe, expect, it } from 'vitest';
import { facesToEquirect, injectPanoramaXmp, PANORAMA_FACES } from '$lib/utils/panorama';

const SIZE = 16;

function solid(red: number): Uint8ClampedArray {
  const image = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < image.length; i += 4) { image[i] = red; image[i + 3] = 255; }
  return image;
}

const faces = PANORAMA_FACES.map((_, index) => solid((index + 1) * 40));
const redAt = (image: Uint8ClampedArray, width: number, row: number, column: number) => image[(row * width + column) * 4];

describe('equirectangular projection', () => {
  const width = 128, height = 64;
  const image = facesToEquirect(faces, SIZE, width, height);

  it('uses right-handed face axes', () => {
    for (const { forward: f, up: u, right: r } of PANORAMA_FACES) {
      expect([f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]].map(v => v + 0)).toEqual([...r]);
    }
  });

  it('places each direction on its face', () => {
    expect(redAt(image, width, 32, 64)).toBe(40); // centre looks forward
    expect(redAt(image, width, 32, 0)).toBe(80); // the seam is behind the viewer
    expect(redAt(image, width, 32, 96)).toBe(120); // three quarters across is the viewer's right
    expect(redAt(image, width, 32, 32)).toBe(160);
    expect(redAt(image, width, 0, 64)).toBe(200);
    expect(redAt(image, width, 63, 64)).toBe(240);
  });

  it('samples rows from the top of the source image', () => {
    const front = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (let i = 0; i < front.length; i += 4) { front[i] = i < front.length / 2 ? 255 : 0; front[i + 3] = 255; }
    const output = facesToEquirect([front, ...faces.slice(1)], SIZE, width, height);
    expect(redAt(output, width, 26, 64)).toBe(255);
    expect(redAt(output, width, 38, 64)).toBe(0);
  });

  it('samples columns so the viewer\'s right stays on the right', () => {
    const front = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (let i = 0; i < front.length; i += 4) { front[i] = (i / 4) % SIZE >= SIZE / 2 ? 255 : 0; front[i + 3] = 255; }
    const output = facesToEquirect([front, ...faces.slice(1)], SIZE, width, height);
    expect(redAt(output, width, 32, 72)).toBe(255);
    expect(redAt(output, width, 32, 56)).toBe(0);
  });

  it('rejects an incomplete cube', () => {
    expect(() => facesToEquirect(faces.slice(1), SIZE, width, height)).toThrow('six faces');
  });
});

describe('photo sphere metadata', () => {
  const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

  it('keeps JFIF first and writes a valid APP1 segment', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xda, 9, 0xff, 0xd9]);
    const output = injectPanoramaXmp(jpeg, 4096, 2048);
    expect([...output.subarray(0, 8)]).toEqual([...jpeg.subarray(0, 8)]);
    expect([output[8], output[9]]).toEqual([0xff, 0xe1]);
    const length = (output[10] << 8) | output[11];
    expect(output.length).toBe(jpeg.length + length + 2);
    expect([...output.subarray(10 + length)]).toEqual([...jpeg.subarray(8)]);
    const written = text(output);
    expect(written).toContain('http://ns.adobe.com/xap/1.0/\0');
    expect(written).toContain('GPano:ProjectionType="equirectangular"');
    expect(written).toContain('GPano:FullPanoWidthPixels="4096"');
  });

  it('inserts directly after the start marker without JFIF', () => {
    const output = injectPanoramaXmp(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]), 2, 1);
    expect([output[2], output[3]]).toEqual([0xff, 0xe1]);
  });

  it('rejects other formats', () => {
    expect(() => injectPanoramaXmp(new Uint8Array([1, 2, 3, 4]), 2, 1)).toThrow('JPEG');
  });
});
