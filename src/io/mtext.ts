// AutoCAD text codes: MTEXT inline formatting and the %% control sequences of TEXT.

/** Replace %%c, %%d, %%p (and %%u/%%o toggles, dropped) and \U+XXXX escapes. */
export function decodeTextCodes(s: string): string {
  return s
    .replace(/%%[cC]/g, '⌀')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[uUoO]/g, '')
    .replace(/%%%/g, '%')
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * MTEXT content to plain lines: formatting codes (\f font;, \H height;, \C colour;, \A alignment;, \W width;,
 * \Q slant;, \T tracking;, \L \O \K toggles, \S stacked fractions, {} groups) are removed, \P and \n end a line,
 * \~ is a hard space, \\ \{ \} are literal.
 */
export function mtextToLines(raw: string): string[] {
  let out = '';
  let i = 0;
  const s = raw;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') {
      const next = s[i + 1];
      if (next === undefined) break;
      if (next === 'P' || next === 'X') {
        out += '\n';
        i += 2;
      } else if (next === '~') {
        out += ' ';
        i += 2;
      } else if (next === '\\' || next === '{' || next === '}') {
        out += next;
        i += 2;
      } else if (next === 'S') {
        // stacked fraction \S<num>^<den>; or \S<num>/<den>; or \S<num>#<den>;
        const end = s.indexOf(';', i + 2);
        const body = end < 0 ? s.slice(i + 2) : s.slice(i + 2, end);
        out += body.replace(/\^\s?/, '/').replace('#', '/');
        i = end < 0 ? s.length : end + 1;
      } else if ('fFHCcAWQTpO'.includes(next) && next !== 'O') {
        // parameterised codes end at the next ';'
        const end = s.indexOf(';', i + 2);
        i = end < 0 ? s.length : end + 1;
      } else if (next === 'p') {
        const end = s.indexOf(';', i + 2);
        i = end < 0 ? s.length : end + 1;
      } else {
        // single-letter toggles: \L \l \O \o \K \k and unknown codes
        i += 2;
      }
    } else if (ch === '{' || ch === '}') {
      i++;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\n') out += '\n';
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return decodeTextCodes(out)
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l, idx, arr) => l !== '' || (idx > 0 && idx < arr.length - 1));
}
