// Object snaps over ALL views, in sheet coordinates (so a T-square projection across views works).
import { closestPoint, dist, distanceTo, endpoints, intersect, perpendicularFeet, snapCandidates, tangentPoints } from '../geom';
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

/**
 * Closest wins, as in AutoCAD, but each kind carries a handicap (fraction of the aperture added to its
 * distance), so a near-tie goes to the stronger point: the corner endpoint beats the midpoint of a small
 * chamfer next to it, while the midpoint of a short line still wins when the cursor is on it.
 * Nearest is a fallback only: it is taken when nothing else lies within the aperture.
 */
export const SNAP_HANDICAP: Record<Exclude<SnapKind, 'nearest'>, number> = {
  endpoint: 0,
  intersection: 0.1,
  center: 0.25,
  midpoint: 0.25,
  quadrant: 0.3,
  perpendicular: 0.35,
  tangent: 0.35,
};

/** Typed one-shot object snap overrides at a point prompt (AutoCAD keywords). */
export const SNAP_OVERRIDES: Record<string, SnapKind> = {
  END: 'endpoint',
  MID: 'midpoint',
  CEN: 'center',
  QUA: 'quadrant',
  INT: 'intersection',
  PER: 'perpendicular',
  TAN: 'tangent',
  NEA: 'nearest',
};

interface Near {
  id: string;
  curve: Curve;
}

/**
 * Best snap within `aperture` (sheet mm) of `cursor`. `from` (sheet mm) is the rubber-band base point,
 * enabling perpendicular and tangent snaps; the perpendicular onto a line also reaches its extension.
 * `only` restricts the result to one kind (a typed override such as PER).
 */
export function findSnap(doc: SheetDoc, cursor: Vec2, aperture: number, from: Vec2 | null, only?: SnapKind): SnapHit | null {
  let best: SnapHit | null = null;
  let bestKey = Infinity;
  const consider = (hit: SnapHit) => {
    if (only && hit.kind !== only) return;
    const d = dist(hit.point, cursor);
    if (d > aperture) return;
    const key = hit.kind === 'nearest' ? 1e6 + d : d + SNAP_HANDICAP[hit.kind] * aperture;
    if (key < bestKey) {
      bestKey = key;
      best = hit;
    }
  };

  const near: Near[] = [];
  const perOnly: Near[] = []; // lines whose extension, not the segment, passes the cursor
  for (const e of visibleEntities(doc)) {
    const curve = entitySheetCurve(doc, e);
    const isNear = distanceTo(curve, cursor) <= aperture;
    if (isNear) near.push({ id: e.id, curve });
    else if (from && curve.kind === 'line' && lineDistance(curve, cursor) <= aperture) perOnly.push({ id: e.id, curve });
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

  if (from) {
    for (const n of perOnly) {
      for (const foot of perpendicularFeet(n.curve, from)) {
        if (dist(foot, from) > 1e-9) consider({ point: foot, kind: 'perpendicular', entityId: n.id, anchor: null });
      }
    }
  }

  for (const n of near) {
    if (from) {
      for (const foot of perpendicularFeet(n.curve, from)) {
        if (dist(foot, from) > 1e-9) consider({ point: foot, kind: 'perpendicular', entityId: n.id, anchor: null });
      }
      if (n.curve.kind !== 'line') {
        for (const t of tangentPoints(n.curve, from)) consider({ point: t, kind: 'tangent', entityId: n.id, anchor: null });
      }
    }
    consider({ point: closestPoint(n.curve, cursor), kind: 'nearest', entityId: n.id, anchor: null });
  }
  return best;
}

/** Distance from `p` to the infinite line through a line curve. */
function lineDistance(c: Extract<Curve, { kind: 'line' }>, p: Vec2): number {
  const l = dist(c.a, c.b);
  if (l === 0) return dist(c.a, p);
  return Math.abs((c.b.x - c.a.x) * (p.y - c.a.y) - (c.b.y - c.a.y) * (p.x - c.a.x)) / l;
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
