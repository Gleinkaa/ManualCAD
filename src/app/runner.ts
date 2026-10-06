// Drives command generators: turns typed text and clicks into Inputs, formats prompts. No DOM.
import type { Vec2 } from '../geom/types';
import { toLocal, toSheet } from '../model/doc';
import type { Entity } from '../model/types';
import { COMMANDS, resolveCommand } from './commands';
import type { CommandContext, CommandGen, Input, Option, Request } from './commands/types';
import { fmt, parseCoordinate, resolveInput } from './input';
import type { SnapHit } from './snap';
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
    this.lastCommand = name;
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

  /** Text from the command line (Enter pressed). Empty text = Enter. */
  text(raw: string): void {
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
        const p = this.parsePoint(text, req.base ?? null);
        if (p) this.feedPoint(p, null);
        else this.invalid(req.options?.length ? 'Point or option keyword required.' : 'Invalid point.');
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
      this.feedPoint(p, snap);
    } else if (req.kind === 'entity') {
      const id = this.host.pick(p, req.filter);
      if (id) this.step({ kind: 'entity', id, p });
      else this.ctx.log('No object found.');
    }
  }

  addSelection(ids: string[], remove: boolean): void {
    if (remove) this.gathering = this.gathering.filter((id) => !ids.includes(id));
    else for (const id of ids) if (!this.gathering.includes(id)) this.gathering.push(id);
  }

  private feedPoint(p: Vec2, snap: SnapHit | null): void {
    this.lastPoint = p;
    this.step({ kind: 'point', p, snap });
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
    this.host.onEnd(name);
  }
}
