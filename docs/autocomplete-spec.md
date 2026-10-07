# Spec: Command-line autocomplete for ManualCAD

## Goal
When the user types in the command line and the runner is **idle** (expecting a command name), show a
filtered dropdown of matching command names and aliases. Enter/Tab accepts the highlighted entry,
arrow keys move the highlight, Escape dismisses the dropdown without cancelling the command.

## Repo
`D:\dev\ManualCAD` — TypeScript + Vite + Canvas2D, tests with vitest.
Run: `npm run typecheck` · `npm test` · `npm run dev`

## Files you will touch
- `src/app/autocomplete.ts`  (NEW — pure matching logic, **no DOM**)
- `src/app/autocomplete.test.ts` (NEW — vitest)
- `src/app/ui.ts` — render the dropdown element, wire its refs into the returned UI object
- `src/app/app.ts` — call the logic from `onInputKey`, manage the active/highlighted index
- `src/app/style.css` — dropdown styling (match existing dark `.mc-command` palette)

## Hard constraints
- **Dependency direction is `app → plot → dim → model → geom`. Never import upward.**
- Keep the matching logic **pure and DOM-free** in `autocomplete.ts` so it unit-tests without a browser.
- Do not change any exported signature in `geom/index.ts`, `dim/index.ts`, `plot/index.ts`.
- Existing tests must keep passing. 264 pass / 1 skipped is the current baseline. Do not weaken a test to make it pass.
- No new runtime dependencies. No emoji. Match the existing sparse comment style.

## Data source
`src/app/commands/index.ts` already exports:
- `COMMANDS: Record<string, CommandFn>` — canonical names, e.g. `LINE`, `DIMLINEAR`, `RECTANG`
- `ALIASES: Record<string, string>` — e.g. `L → LINE`, `DLI → DIMLINEAR`, `REC → RECTANG`
- `HOST_COMMANDS: readonly string[]` — `UNDO, REDO, SAVE, OPEN, NEW, PLOT, EXPORTPDF`

## Required matching behaviour
Given the typed text `t` (trimmed, uppercased):

1. Empty `t` → show nothing (do not open a dropdown on an empty line).
2. Exact match on a canonical name or an alias → **still show the dropdown** with that entry first, so
   the user sees confirmation. (Chosen deliberately; do not "optimise" this away.)
3. Prefix matches rank above substring matches.
4. Canonical command names rank above aliases.
5. Within the same rank tier, sort alphabetically.
6. Cap the result list (suggest 8) unless a test shows a reason to differ.
7. Each entry needs: the text to insert, a display label, and a kind tag (`'command'` | `'alias'` | `'host'`).
   For an alias, the label must show what it resolves to (e.g. `L` → `LINE`).
8. Matching must be case-insensitive and must tolerate a leading `_` (AutoCAD convention, see
   `resolveCommand` in `commands/index.ts`).

## Required interaction behaviour
- Autocomplete is **only active while the runner is idle** (`this.runner.active === false`); once a command
  is running, the typed text is answering a prompt (coordinates, options) and must NOT be autocompleted.
- Also suppress it when the runner's current request `kind === 'text'`.
- `ArrowDown` / `ArrowUp` move the highlight, and must not move the caret.
- `Enter` accepts the highlight instead of submitting — but only when a dropdown entry is highlighted.
  If no dropdown is open, `Enter` keeps its current behaviour (submit).
- `Tab` accepts the highlight.
- `Escape` closes the dropdown; a second `Escape` falls through to the existing escape behaviour.
- Editing the text (any keystroke that changes `input.value`) recomputes the list.
- Clicking an entry accepts it.
- The dropdown must never swallow the existing Space-to-submit and Enter-to-submit paths
  (`onInputKey` lines ~480-487) when it is not open.

## Verification you must perform yourself
1. `npm run typecheck` — clean.
2. `npm test` — all pre-existing tests still pass, plus your new tests.
3. Write tests covering, at minimum: empty input, exact match, prefix vs substring ranking, canonical
   before alias, the `_` prefix, `DLI` resolving to `DIMLINEAR`, and the cap.
4. Start `npm run dev` and **actually exercise it in a browser.** Confirm by real interaction that:
   - typing `di` shows the DIM* commands,
   - `ArrowDown` + `Enter` inserts the highlighted command and does not submit the line,
   - the dropdown does NOT appear while a command is mid-prompt (e.g. after starting `CIRCLE`,
     typing `4` at the radius prompt shows no dropdown).

Report exactly what you ran and what you observed, including anything that did not work.
