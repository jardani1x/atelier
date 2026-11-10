export type PanoramaVector = readonly [number, number, number];

export interface PanoramaFace {
  name: string;
  forward: PanoramaVector;
  up: PanoramaVector;
  right: PanoramaVector;
}

/** Six 90-degree views in the viewer's own frame: forward is -z, right is +x, up is +y. */
export const PANORAMA_FACES: readonly PanoramaFace[] = [
  { name: 'front', forward: [0, 0, -1], up: [0, 1, 0], right: [1, 0, 0] },
  { name: 'back', forward: [0, 0, 1], up: [0, 1, 0], right: [-1, 0, 0] },
  { name: 'right', forward: [1, 0, 0], up: [0, 1, 0], right: [0, 0, 1] },
  { name: 'left', forward: [-1, 0, 0], up: [0, 1, 0], right: [0, 0, -1] },
  { name: 'up', forward: [0, 1, 0], up: [0, 0, 1], right: [1, 0, 0] },
  { name: 'down', forward: [0, -1, 0], up: [0, 0, -1], right: [1, 0, 0] },
];

const dot = (a: PanoramaVector, x: number, y: number, z: number) => a[0] * x + a[1] * y + a[2] * z;

/**
 * Projects six square RGBA images, in PANORAMA_FACES order with row 0 at the top,
 * to an equirectangular RGBA image whose centre is the viewer's forward direction.
 */
export function facesToEquirect(faces: readonly Uint8ClampedArray[], faceSize: number, width: number, height: number): Uint8ClampedArray {
  if (faces.length !== PANORAMA_FACES.length) throw new Error('A panorama needs exactly six faces.');
  const output = new Uint8ClampedArray(width * height * 4);
  const last = faceSize - 1;
  for (let row = 0; row < height; row++) {
    const latitude = (0.5 - (row + 0.5) / height) * Math.PI;
    const cosLatitude = Math.cos(latitude), y = Math.sin(latitude);
    for (let column = 0; column < width; column++) {
      const longitude = ((column + 0.5) / width - 0.5) * Math.PI * 2;
      const x = Math.sin(longitude) * cosLatitude;
      const z = -Math.cos(longitude) * cosLatitude;

      let best = 0, bestDot = -Infinity;
      for (let i = 0; i < PANORAMA_FACES.length; i++) {
        const facing = dot(PANORAMA_FACES[i].forward, x, y, z);
        if (facing > bestDot) { bestDot = facing; best = i; }
      }
      const face = PANORAMA_FACES[best], source = faces[best];
      const px = ((dot(face.right, x, y, z) / bestDot + 1) / 2) * faceSize - 0.5;
      const py = ((1 - dot(face.up, x, y, z) / bestDot) / 2) * faceSize - 0.5;
      const clampedX = Math.max(0, Math.min(last, px)), clampedY = Math.max(0, Math.min(last, py));
      const x0 = Math.floor(clampedX), y0 = Math.floor(clampedY);
      const x1 = Math.min(last, x0 + 1), y1 = Math.min(last, y0 + 1);
      const fx = clampedX - x0, fy = clampedY - y0;
      const target = (row * width + column) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const top = source[(y0 * faceSize + x0) * 4 + channel] * (1 - fx) + source[(y0 * faceSize + x1) * 4 + channel] * fx;
        const bottom = source[(y1 * faceSize + x0) * 4 + channel] * (1 - fx) + source[(y1 * faceSize + x1) * 4 + channel] * fx;
        output[target + channel] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return output;
}

const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';

function panoramaXmp(width: number, height: number): string {
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/" GPano:UsePanoramaViewer="True" GPano:ProjectionType="equirectangular" GPano:FullPanoWidthPixels="${width}" GPano:FullPanoHeightPixels="${height}" GPano:CroppedAreaImageWidthPixels="${width}" GPano:CroppedAreaImageHeightPixels="${height}" GPano:CroppedAreaLeftPixels="0" GPano:CroppedAreaTopPixels="0"/></rdf:RDF></x:xmpmeta><?xpacket end="r"?>`;
}

/** Adds the photo-sphere XMP segment that 360 viewers use to recognise a panorama. */
export function injectPanoramaXmp(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Expected a JPEG image.');
  const payload = new TextEncoder().encode(XMP_HEADER + panoramaXmp(width, height));
  const segmentLength = payload.length + 2;
  // JFIF requires its APP0 segment directly after the start-of-image marker.
  const insertAt = jpeg[2] === 0xff && jpeg[3] === 0xe0 ? 4 + ((jpeg[4] << 8) | jpeg[5]) : 2;
  const output = new Uint8Array(jpeg.length + segmentLength + 2);
  output.set(jpeg.subarray(0, insertAt));
  output.set([0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff], insertAt);
  output.set(payload, insertAt + 4);
  output.set(jpeg.subarray(insertAt), insertAt + 4 + payload.length);
  return output;
}
