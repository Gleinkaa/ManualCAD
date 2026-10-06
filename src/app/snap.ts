// Object snaps over ALL views, in sheet coordinates (so a T-square projection across views works).
import { closestPoint, dist, distanceTo, endpoints, intersect, perpendicularFoot, snapCandidates, tangentPoints } from '../geom';
import type { Curve, SnapKind, Vec2 } from '../geom/types';
import type { AnchorPoint, SheetDoc } from '../model/types';
import { entitySheetCurve, visibleEntities } from './xform';

export interface SnapHit {
  point: Vec2;               // sheet mm
  kind: SnapKind;
  entityId: string | null;
  /** Associative anchor for dimensions, if the snap is a characteristic point of the entity. */
  anchor: AnchorPoint | null;
}

export const SNAP_LABELS: Record<SnapKind, string> = {
  endpoint: 'Endpoint',
  midpoint: 'Midpoint',
  center: 'Center',
  quadrant: 'Quadrant',
  intersection: 'Intersection',
  perpendicular: 'Perpendicular',
  tangent: 'Tangent',
  nearest: 'Nearest',
};

const PRIORITY: Record<SnapKind, number> = {
  endpoint: 0,
  midpoint: 0,
  center: 0,
  quadrant: 0,
  intersection: 0,
  perpendicular: 1,
  tangent: 1,
  nearest: 2,
};

interface Near {
  id: string;
  curve: Curve;
}

/**
 * Best snap within `aperture` (sheet mm) of `cursor`. `from` (sheet mm) is the rubber-band base point,
 * enabling perpendicular and tangent snaps.
 */
export function findSnap(doc: SheetDoc, cursor: Vec2, aperture: number, from: Vec2 | null): SnapHit | null {
  let best: SnapHit | null = null;
  let bestKey = Infinity;
  const consider = (hit: SnapHit) => {
    const d = dist(hit.point, cursor);
    if (d > aperture) return;
    const key = PRIORITY[hit.kind] * 1e6 + d;
    if (key < bestKey) {
      bestKey = key;
      best = hit;
    }
  };

  const near: Near[] = [];
  for (const e of visibleEntities(doc)) {
    const curve = entitySheetCurve(doc, e);
    const isNear = distanceTo(curve, cursor) <= aperture;
    if (isNear) near.push({ id: e.id, curve });
    if (!isNear && curve.kind === 'line') continue;
    for (const s of snapCandidates(curve)) {
      consider({ point: s.point, kind: s.kind, entityId: e.id, anchor: anchorOf(curve, s.kind, s.point) });
    }
  }

  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      for (const p of intersect(near[i].curve, near[j].curve)) {
        consider({ point: p, kind: 'intersection', entityId: null, anchor: null });
      }
    }
  }

  for (const n of near) {
    if (from) {
      const foot = perpendicularFoot(n.curve, from);
      if (foot && dist(foot, from) > 1e-9) consider({ point: foot, kind: 'perpendicular', entityId: n.id, anchor: null });
      if (n.curve.kind !== 'line') {
        for (const t of tangentPoints(n.curve, from)) consider({ point: t, kind: 'tangent', entityId: n.id, anchor: null });
      }
    }
    consider({ point: closestPoint(n.curve, cursor), kind: 'nearest', entityId: n.id, anchor: null });
  }
  return best;
}

function anchorOf(curve: Curve, kind: SnapKind, p: Vec2): AnchorPoint | null {
  switch (kind) {
    case 'center':
      return 'center';
    case 'midpoint':
      return 'mid';
    case 'endpoint': {
      const ends = endpoints(curve);
      if (!ends) return null;
      return dist(ends[0], p) <= dist(ends[1], p) ? 'start' : 'end';
    }
    default:
      return null;
  }
}
