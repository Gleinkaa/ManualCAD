// Drives command generators: turns typed text and clicks into Inputs, formats prompts. No DOM.
import type { Vec2 } from '../geom/types';
import { toLocal, toSheet } from '../model/doc';
import type { Entity } from '../model/types';
import { COMMANDS, isHiddenCommand, resolveCommand } from './commands';
import { updateAssociativeHatches } from './commands/hatch';
import type { CommandContext, CommandGen, Input, Option, Request } from './commands/types';
import { applyLock, fmt, parseCoordinate, resolveInput, type InputLock } from './input';
import type { SnapKind } from '../geom/types';
import { SNAP_LABELS, SNAP_OVERRIDES, type SnapHit } from './snap';
import { visibleEntities } from './xform';

export interface RunnerHost {
  /** Entity under `p` (sheet mm), honouring an optional filter. */
  pick(p: Vec2, filter?: (e: Entity) => boolean): string | null;
  /** UNDO, SAVE, ... */
  hostCommand(name: string): void;
  /** The noun-verb pre-selection handed to a starting command (and cleared). */
  takeSelection(): string[];
  /** Called before a command starts and after it ends (or is cancelled). */
  onStart(name: string): void;
  onEnd(name: string): void;
}

export function formatPrompt(req: Request): string {
  let s = req.prompt;
  if (req.options && req.options.length > 0) s += ` [${req.options.map((o) => o.label).join('/')}]`;
  if ((req.kind === 'number' || req.kind === 'text') && req.default !== undefined && req.default !== '') {
    s += ` <${typeof req.default === 'number' ? fmt(req.default, 4) : req.default}>`;
  }
  return `${s}:`;
}

function matchOption(options: Option[] | undefined, text: string): Option | undefined {
  if (!options) return undefined;
  const t = text.trim().toUpperCase();
  if (!t) return undefined;
  return options.find((o) => o.key.toUpperCase() === t) ?? options.find((o) => o.label.toUpperCase() === t);
}

export class CommandRunner {
  name: string | null = null;
  request: Request | null = null;
  lastCommand: string | null = null;
  /** Last point entered (sheet mm), base for `@` input. */
  lastPoint: Vec2 | null = null;
  /** Current (constrained) cursor in sheet mm, gives the direction for direct distance entry. */
  cursor: Vec2 | null = null;
  /** Objects gathered during a "Select objects" request. */
  gathering: string[] = [];
  private gen: CommandGen | null = null;
  /** One-shot object snap typed at the current point prompt (END, MID, PER, ...); cleared by the next point. */
  snapOverride: SnapKind | null = null;
  /** Dynamic input: length and/or angle locked for the next point (typed, then Tab or Enter); cleared by the next point. */
  lock: InputLock = { length: null, angleDeg: null };
  /** Dynamic input field a bare number goes to: length first, Tab moves to the angle (AutoCAD dimension input). */
  lockField: 'length' | 'angle' = 'length';
  /** Set when the last typed text was rejected as invalid input. */
  private rejected = false;

  readonly ctx: CommandContext;
  private readonly host: RunnerHost;

  constructor(ctx: CommandContext, host: RunnerHost) {
    this.ctx = ctx;
    this.host = host;
  }

  get active(): boolean {
    return this.gen !== null;
  }

  get prompt(): string {
    return this.request ? formatPrompt(this.request) : 'Command:';
  }

  start(name: string, preselection?: string[]): void {
    if (this.gen) this.cancel();
    const fn = COMMANDS[name];
    if (!fn) {
      this.host.hostCommand(name);
      return;
    }
    if (!isHiddenCommand(name)) this.lastCommand = name;
    this.name = name;
    this.host.onStart(name);
    this.ctx.preselection = preselection ?? this.host.takeSelection();
    this.gathering = [];
    this.gen = fn(this.ctx);
    this.step(undefined);
  }

  cancel(): void {
    if (!this.gen) return;
    this.ctx.log('*Cancel*');
    try {
      this.gen.return();
    } catch {
      // a command's finally block failing must not keep it alive
    }
    this.finish();
  }

  /** Text from the command line (Enter pressed). Empty text = Enter. Returns false when the text was rejected, so the UI can leave it in the input for correction. */
  text(raw: string): boolean {
    this.rejected = false;
    this.feedText(raw);
    return !this.rejected;
  }

  private feedText(raw: string): void {
    const text = raw.trim();
    if (!this.gen || !this.request) {
      this.ctx.log(`Command: ${text}`);
      if (!text) {
        if (this.lastCommand) this.start(this.lastCommand);
        return;
      }
      const name = resolveCommand(text);
      if (!name) {
        this.ctx.log(`Unknown command "${text.toUpperCase()}".`);
        return;
      }
      this.start(name);
      return;
    }
    const req = this.request;
    this.ctx.log(`${this.prompt} ${text}`);
    if (!text) {
      this.enter();
      return;
    }
    const opt = matchOption(req.options, text);
    if (opt) {
      this.step({ kind: 'option', key: opt.key });
      return;
    }
    switch (req.kind) {
      case 'point': {
        const override = SNAP_OVERRIDES[text.toUpperCase()];
        if (override) {
          if ((override === 'perpendicular' || override === 'tangent') && !req.base) {
            this.invalid(`${SNAP_LABELS[override]} needs a base point; pick the first point another way.`);
            return;
          }
          this.snapOverride = override;
          this.ctx.log(`${SNAP_LABELS[override]} snap for the next point.`);
          return;
        }
        // dynamic input first once a value is locked or the angle field is active: a bare number is then not a radius
        const dyn = !!req.base && (this.locked || this.lockField === 'angle');
        if (dyn && this.lockText(text, 'enter')) return;
        if (req.acceptNumber) {
          const parsed = parseCoordinate(text);
          if (parsed?.kind === 'number') {
            this.step({ kind: 'number', value: parsed.value });
            return;
          }
        }
        if (!dyn && req.base && this.lockText(text, 'enter')) return;
        const p = this.parsePoint(text, req.base ?? null);
        if (p) this.feedPoint(p, null);
        else this.invalid(req.base ? `Requires a point, a distance or an angle${req.options?.length ? ', or an option keyword' : ''}.` : req.options?.length ? 'Point or option keyword required.' : 'Invalid point.');
        return;
      }
      case 'number': {
        const parsed = parseCoordinate(text);
        if (parsed?.kind === 'number') this.step({ kind: 'number', value: parsed.value });
        else this.invalid('Requires a number.');
        return;
      }
      case 'text':
        this.step({ kind: 'text', text });
        return;
      case 'selection':
        if (text.toUpperCase() === 'ALL') {
          this.addSelection(visibleEntities(this.ctx.doc).map((e) => e.id), false);
          this.ctx.log(`${this.gathering.length} found`);
        } else {
          this.invalid('Select objects by clicking or a window, Enter to finish.');
        }
        return;
      case 'entity':
        this.invalid('Select an object by clicking.');
        return;
    }
  }

  /** Enter / Space / right-click. */
  enter(): void {
    if (!this.gen || !this.request) {
      if (this.lastCommand) this.start(this.lastCommand);
      return;
    }
    const req = this.request;
    if (req.kind === 'selection') {
      const ids = this.gathering;
      this.gathering = [];
      this.step({ kind: 'selection', ids });
      return;
    }
    if (req.kind === 'number' && req.default !== undefined) {
      this.step({ kind: 'number', value: req.default });
      return;
    }
    if (req.kind === 'text' && req.default !== undefined) {
      const opt = matchOption(req.options, req.default);
      this.step(opt ? { kind: 'option', key: opt.key } : { kind: 'text', text: req.default });
      return;
    }
    if (req.allowEnter || req.kind === 'text') {
      this.step({ kind: 'enter' });
      return;
    }
    // Enter where input is required ends the command, like AutoCAD does for most first prompts.
    this.cancel();
  }

  /** A click in the drawing (sheet mm, already snapped/constrained by the caller). */
  click(p: Vec2, snap: SnapHit | null): void {
    const req = this.request;
    if (!this.gen || !req) return;
    if (req.kind === 'point' || req.kind === 'entity') this.ctx.log(this.prompt);
    if (req.kind === 'point') {
      if (this.snapOverride && snap?.kind !== this.snapOverride) {
        this.ctx.log(`No ${SNAP_LABELS[this.snapOverride].toLowerCase()} found at that point.`);
        return;
      }
      this.feedPoint(p, snap);
    } else if (req.kind === 'entity') {
      const id = this.host.pick(p, req.filter);
      if (id) this.step({ kind: 'entity', id, p });
      else this.ctx.log(req.filter && this.host.pick(p) ? 'Object is not valid for this command.' : 'No object found.');
    }
  }

  addSelection(ids: string[], remove: boolean): void {
    if (remove) this.gathering = this.gathering.filter((id) => !ids.includes(id));
    else for (const id of ids) if (!this.gathering.includes(id)) this.gathering.push(id);
  }

  private feedPoint(p: Vec2, snap: SnapHit | null): void {
    this.snapOverride = null;
    this.unlock();
    this.lastPoint = p;
    this.step({ kind: 'point', p, snap });
  }

  /** True while a length or angle is locked for the next point. */
  get locked(): boolean {
    return this.lock.length !== null || this.lock.angleDeg !== null;
  }

  /**
   * Dynamic input at a rubber-band point prompt (AutoCAD dimension input). Two fields sit at the cursor,
   * length and angle; a bare number goes to the active field (`lockField`), `50mm`, `<20`, `20°` name theirs.
   * `tab` locks the typed value (the mouse then sets the other one) and moves to the other field; with no
   * text it only moves. `enter` places the point once both values are known; a length alone is direct
   * distance along the cursor (left to the caller), an angle alone locks it and asks for the length.
   * Returns false when the text is not a length or angle, so the caller can treat it as a point.
   */
  lockText(text: string, how: 'tab' | 'enter'): boolean {
    const req = this.request;
    if (req?.kind !== 'point' || !req.base) return false;
    const t = text.trim();
    const other = this.lockField === 'length' ? 'angle' : 'length';
    if (how === 'tab' && !t) {
      this.lockField = other;
      return true;
    }
    let parsed = parseCoordinate(t);
    if (parsed?.kind === 'number' && this.lockField === 'angle') parsed = { kind: 'angle', deg: parsed.value };
    if (!parsed || (parsed.kind !== 'number' && parsed.kind !== 'angle')) return false;
    const lock: InputLock = { ...this.lock };
    if (parsed.kind === 'number') lock.length = parsed.value;
    else lock.angleDeg = parsed.deg;
    if (how === 'enter') {
      if (lock.length !== null && lock.angleDeg !== null) {
        const view = this.ctx.view();
        const lb = toLocal(view, req.base);
        const p = applyLock(lb, lb, lock);
        if (p) this.feedPoint(toSheet(view, p), null);
        return true;
      }
      if (parsed.kind === 'number') return false; // direct distance along the cursor: handled by parsePoint
      this.lock = lock;
      this.lockField = 'length';
    } else {
      this.lock = lock;
      this.lockField = parsed.kind === 'number' ? 'angle' : 'length';
    }
    this.ctx.log(`${this.lockLabel()} · move the mouse or type the ${this.lockField}, Tab locks it`);
    return true;
  }

  /** Drop a dynamic input lock (Esc) and start again at the length field. */
  unlock(): void {
    this.lock = { length: null, angleDeg: null };
    this.lockField = 'length';
  }

  /** "Length 50.00 mm locked", "Angle 20° locked" or both, for the status bar. */
  lockLabel(): string {
    const parts: string[] = [];
    if (this.lock.length !== null) parts.push(`Length ${fmt(this.lock.length)} mm`);
    if (this.lock.angleDeg !== null) parts.push(`Angle ${fmt(this.lock.angleDeg, 1)}°`);
    return parts.length ? `${parts.join(', ')} locked` : '';
  }

  private parsePoint(text: string, base: Vec2 | null): Vec2 | null {
    const parsed = parseCoordinate(text);
    if (!parsed) return null;
    const view = this.ctx.view();
    const L = (p: Vec2 | null) => (p ? toLocal(view, p) : null);
    let dir = L(this.cursor);
    const lb = L(base);
    if (parsed.kind === 'number' && lb && (!dir || Math.hypot(dir.x - lb.x, dir.y - lb.y) < 1e-9)) dir = { x: lb.x + 1, y: lb.y };
    const local = resolveInput(parsed, L(this.lastPoint), lb, dir);
    return local ? toSheet(view, local) : null;
  }

  private invalid(msg: string): void {
    this.rejected = true;
    this.ctx.log(msg);
  }

  private step(input: Input | undefined): void {
    if (!this.gen) return;
    try {
      const r = input === undefined ? this.gen.next(undefined as unknown as Input) : this.gen.next(input);
      if (r.done) this.finish();
      else this.request = r.value;
    } catch (err) {
      this.ctx.log(`Error: ${err instanceof Error ? err.message : String(err)}`);
      this.finish();
    }
  }

  private finish(): void {
    const name = this.name ?? '';
    this.gen = null;
    this.request = null;
    this.name = null;
    this.gathering = [];
    this.snapOverride = null;
    this.unlock();
    const lost = updateAssociativeHatches(this.ctx.doc);
    if (lost > 0) this.ctx.log(`${lost} hatch(es) lost their boundary and no longer follow edits.`);
    this.host.onEnd(name);
  }
}
