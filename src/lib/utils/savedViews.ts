import type { SavedView, SolidVector } from '$lib/models/types';

export type ViewPose = Pick<SavedView, 'position' | 'target'>;

/** Time spent moving between two neighbouring views in a tour video. */
export const TOUR_SEGMENT_MS = 4000;

export function tourDurationMs(viewCount: number): number {
  return Math.max(0, viewCount - 1) * TOUR_SEGMENT_MS;
}

const mix = (a: SolidVector, b: SolidVector, t: number): SolidVector => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

/** Pose at `progress` (0 to 1) along the tour, easing in and out of every view. */
export function tourPose(views: readonly ViewPose[], progress: number): ViewPose {
  if (views.length === 0) throw new Error('A tour needs at least one view');
  const last = views.length - 1;
  const position = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)) * last;
  const index = Math.min(Math.floor(position), Math.max(0, last - 1));
  const from = views[index], to = views[Math.min(index + 1, last)];
  const local = position - index;
  const eased = local * local * (3 - 2 * local);
  return { position: mix(from.position, to.position, eased), target: mix(from.target, to.target, eased) };
}
