import { resolveCommand } from './commands';

/**
 * What Enter on the command line submits while the autocomplete list is open.
 * An explicitly navigated highlight (arrow keys) always wins; otherwise a typed command name is
 * taken as is, and a partial name runs the first (default-highlighted) suggestion.
 */
export function submitText(text: string, suggestions: readonly { name: string }[], index: number, navigated: boolean): string {
  if (!text.trim() || suggestions.length === 0) return text;
  if (navigated && index >= 0 && index < suggestions.length) return suggestions[index].name;
  if (resolveCommand(text)) return text;
  return suggestions[Math.max(0, index)].name;
}
