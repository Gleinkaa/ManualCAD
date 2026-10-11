// Text entry helpers shared by the annotation and symbol commands.

/** AutoCAD control codes: %%c → ⌀, %%d → °, %%p → ±. */
export function expandControlCodes(s: string): string {
  return s.replace(/%%c/gi, '⌀').replace(/%%d/gi, '°').replace(/%%p/gi, '±');
}
