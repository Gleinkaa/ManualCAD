// Command-line autocomplete: matches typed text against command names and aliases. No DOM.
import { ALIASES, COMMANDS, HOST_COMMANDS } from './commands';

export type SuggestionKind = 'command' | 'alias' | 'host';

export interface Suggestion {
  /** Text placed in the command line when accepted. */
  insert: string;
  /** Shown in the dropdown; an alias shows what it resolves to, e.g. `L → LINE`. */
  label: string;
  kind: SuggestionKind;
}

export interface CommandSources {
  commands: readonly string[];
  aliases: Readonly<Record<string, string>>;
  host: readonly string[];
}

export const DEFAULT_SOURCES: CommandSources = { commands: Object.keys(COMMANDS), aliases: ALIASES, host: HOST_COMMANDS };

export const MAX_SUGGESTIONS = 8;

/**
 * Suggestions for the typed text, best first: exact match, then prefix before substring,
 * canonical names (commands and host commands) before aliases, alphabetical within a tier.
 */
export function suggest(text: string, sources: CommandSources = DEFAULT_SOURCES, limit = MAX_SUGGESTIONS): Suggestion[] {
  const t = text.trim().toUpperCase().replace(/^_/, '');
  if (t === '' || /\s/.test(t)) return [];
  const candidates: Suggestion[] = [
    ...sources.commands.map((n): Suggestion => ({ insert: n, label: n, kind: 'command' })),
    ...sources.host.map((n): Suggestion => ({ insert: n, label: n, kind: 'host' })),
    ...Object.entries(sources.aliases).map(([a, n]): Suggestion => ({ insert: a, label: `${a} → ${n}`, kind: 'alias' })),
  ];
  const ranked: [number, Suggestion][] = [];
  for (const s of candidates) {
    const at = s.insert.indexOf(t);
    if (at < 0) continue;
    const alias = s.kind === 'alias' ? 1 : 0;
    const tier = s.insert === t ? 0 : at === 0 ? 1 + alias : 3 + alias;
    ranked.push([tier, s]);
  }
  ranked.sort(([ta, a], [tb, b]) => ta - tb || (a.insert < b.insert ? -1 : a.insert > b.insert ? 1 : 0));
  return ranked.slice(0, limit).map(([, s]) => s);
}

/** Highlight index after an arrow key; -1 means nothing highlighted. Wraps around. */
export function moveHighlight(index: number, count: number, dir: 1 | -1): number {
  if (count === 0) return -1;
  if (index < 0) return dir === 1 ? 0 : count - 1;
  return (index + dir + count) % count;
}
