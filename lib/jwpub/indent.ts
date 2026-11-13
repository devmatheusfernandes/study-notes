/**
 * Paragraph indentation for .jwpub content.
 *
 * A `.jwpub` archive ships NO stylesheet — the JW Library app supplies its own,
 * and the markup only carries a class per paragraph (`class="s6"`). Without
 * that CSS every paragraph sits flush left, which is why "a. / b. / c." sub-items
 * that the app indents rendered here as plain full-width lines.
 *
 * These are the indent rules from jw.org's own stylesheet (the `.jwac.dir-ltr`
 * ones for left-to-right languages), which is the same CSS family the app uses:
 * `.s6 { margin-left: 64px }` matches what the app draws, measured on screen.
 * Only rules in `px` are kept; the percentage/utility ones (`du-margin-…`) are
 * layout helpers for jw.org's page chrome, not paragraph styles.
 *
 * Plain data on purpose: the reader turns it into CSS (`jwIndentCss`) and the
 * copy handler turns it into an inline margin (`jwIndentPx`) so an indented
 * paragraph keeps its indent when pasted into a note.
 */

/** Left offset in px per paragraph class — margin and padding together, since both push the text right. */
const JW_INDENT_PX: Readonly<Record<string, { margin?: number; padding?: number }>> = {
  sa: { margin: 24 },
  si: { margin: 40 },
  sz: { margin: 48, padding: 20 },
  s5: { margin: 32 },
  s6: { margin: 64 },
  s7: { margin: 96 },
  s8: { margin: 128 },
  s9: { margin: 160 },
  s0: { margin: 192 },
  sl: { padding: 40 },
  sp: { padding: 40 },
  su: { padding: 20 },
  sx: { padding: 20 },
  sv: { padding: 80 },
  sy: { padding: 80 },
};

/** The CSS class that scopes these rules — put it on the element wrapping the content. */
export const JW_INDENT_SCOPE = "jw-indent";

/** Rules for every indent class, scoped to `.jw-indent`. Inside a list item or quote the app resets the margin (the list already indents). */
export const JW_INDENT_CSS: string = Object.entries(JW_INDENT_PX)
  .flatMap(([name, { margin, padding }]) => {
    const declarations = [
      margin ? `margin-left:${margin}px` : "",
      padding ? `padding-left:${padding}px` : "",
    ]
      .filter(Boolean)
      .join(";");
    const rules = [`.${JW_INDENT_SCOPE} .${name}{${declarations}}`];
    if (margin) {
      rules.push(`.${JW_INDENT_SCOPE} li .${name},.${JW_INDENT_SCOPE} blockquote .${name}{margin-left:0}`);
    }
    return rules;
  })
  .join("\n");

/** How far a paragraph with these classes is indented, in px (0 for none). */
export function jwIndentPx(classNames: string): number {
  let total = 0;
  for (const name of classNames.split(/\s+/)) {
    const entry = JW_INDENT_PX[name];
    if (entry) total = Math.max(total, (entry.margin ?? 0) + (entry.padding ?? 0));
  }
  return total;
}
