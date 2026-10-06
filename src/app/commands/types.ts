// Command protocol: each command is a generator that yields Requests and receives Inputs. No DOM.
import type { Curve, Vec2 } from '../../geom/types';
import { getView, newId, toLocal } from '../../model/doc';
import { HATCH_SPACING_DEFAULT } from '../../model/standards';
import type { Annotation, Dimension, Entity, LineTypeId, SheetDoc, View } from '../../model/types';
import type { SnapHit } from '../snap';
import { curveToLocal, entitySheetCurve } from '../xform';

export interface Option {
  key: string;               // what the user types, e.g. "C"
  label: string;             // shown in the prompt, e.g. "Close"
}

export interface PointInput {
  kind: 'point';
  p: Vec2;                   // sheet mm
  snap: SnapHit | null;
}

export type Input =
  | PointInput
  | { kind: 'entity'; id: string; p: Vec2 }   // p = pick point, sheet mm
  | { kind: 'selection'; ids: string[] }
  | { kind: 'option'; key: string }
  | { kind: 'number'; value: number }
  | { kind: 'text'; text: string }
  | { kind: 'enter' };

/** Rubber-band preview. Curves are view-local of `viewId` (default: current view). */
export interface Preview {
  curves?: { curve: Curve; lineType: LineTypeId; viewId?: string }[];
  dims?: Dimension[];
  annotations?: Annotation[];
  /** Entity ids drawn as "moving" ghosts are not needed: commands put the moved curves into `curves`. */
  markers?: Vec2[];           // sheet mm
}

interface BaseRequest {
  prompt: string;
  options?: Option[];
  allowEnter?: boolean;
}

export type Request =
  | (BaseRequest & {
      kind: 'point';
      base?: Vec2;            // sheet mm: rubber-band origin (enables ortho/polar/direct distance)
      preview?: (p: Vec2, snap: SnapHit | null) => Preview;
    })
  | (BaseRequest & { kind: 'entity'; filter?: (e: Entity) => boolean })
  | (BaseRequest & { kind: 'selection' })
  | (BaseRequest & { kind: 'number'; default?: number })
  | (BaseRequest & { kind: 'text'; default?: string });

export type CommandGen = Generator<Request, void, Input>;
export type SubGen<T> = Generator<Request, T, Input>;

export interface AppSettings {
  currentViewId: string;
  lineType: LineTypeId;
  layer: string;
  filletRadius: number;
  chamferA: number;
  chamferB: number;
  offsetDistance: number | null;   // null = Through
  textHeight: number;              // paper mm, ISO 3098 series
  hatchAngle: number;              // degrees
  hatchSpacing: number;            // paper mm
}

export function defaultSettings(doc: SheetDoc): AppSettings {
  return {
    currentViewId: doc.views[0]?.id ?? '',
    lineType: 'visible',
    layer: doc.layers[0]?.name ?? '0',
    filletRadius: 0,
    chamferA: 0,
    chamferB: 0,
    offsetDistance: null,
    textHeight: 3.5,
    hatchAngle: 45,
    hatchSpacing: HATCH_SPACING_DEFAULT,
  };
}

/** App actions that need the DOM; absent in tests. */
export interface HostActions {
  zoomExtents?(): void;
  titleBlock?(): void;
  partsList?(): void;
}

export class CommandContext {
  preselection: string[] = [];

  private readonly getDoc: () => SheetDoc;
  readonly settings: AppSettings;
  readonly log: (msg: string) => void;
  readonly host: HostActions;

  constructor(getDoc: () => SheetDoc, settings: AppSettings, log: (msg: string) => void, host: HostActions = {}) {
    this.getDoc = getDoc;
    this.settings = settings;
    this.log = log;
    this.host = host;
  }

  get doc(): SheetDoc {
    return this.getDoc();
  }

  view(): View {
    return getView(this.doc, this.settings.currentViewId);
  }

  viewOf(id: string): View {
    return getView(this.doc, id);
  }

  /** Sheet → current view local. */
  local(p: Vec2): Vec2 {
    return toLocal(this.view(), p);
  }

  localIn(viewId: string, p: Vec2): Vec2 {
    return toLocal(this.viewOf(viewId), p);
  }

  entity(id: string): Entity | undefined {
    return this.doc.entities.find((e) => e.id === id);
  }

  sheetCurve(e: Entity): Curve {
    return entitySheetCurve(this.doc, e);
  }

  /** Curve of `e` expressed in the local coordinates of `viewId`. */
  curveIn(e: Entity, viewId: string): Curve {
    return e.viewId === viewId ? e.geom : curveToLocal(this.viewOf(viewId), this.sheetCurve(e));
  }

  /** Add an entity in the current view with the current line type and layer. `curve` is view-local. */
  addEntity(curve: Curve, props?: Partial<Pick<Entity, 'viewId' | 'layer' | 'lineType'>>): Entity {
    const e: Entity = {
      id: newId('e'),
      viewId: props?.viewId ?? this.settings.currentViewId,
      layer: props?.layer ?? this.settings.layer,
      lineType: props?.lineType ?? this.settings.lineType,
      geom: curve,
    };
    this.doc.entities.push(e);
    return e;
  }

  removeEntity(id: string): void {
    const doc = this.doc;
    doc.entities = doc.entities.filter((e) => e.id !== id);
  }
}

/** Use the noun-verb pre-selection if there is one, else ask "Select objects:". */
export function* selectObjects(ctx: CommandContext, prompt = 'Select objects'): SubGen<string[]> {
  if (ctx.preselection.length > 0) {
    const ids = ctx.preselection;
    ctx.preselection = [];
    return ids;
  }
  const r = yield { kind: 'selection', prompt };
  return r.kind === 'selection' ? r.ids : [];
}

export type CommandFn = (ctx: CommandContext) => CommandGen;
