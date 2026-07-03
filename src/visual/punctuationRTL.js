// fontPunctuationRTL support.
//
// Handles RTL punctuation for Arabic/Urdu/Persian text rendered to a canvas
// (where HTML dir/CSS direction do not apply — reading text is rasterized via
// PIXI.Text -> Canvas 2D fillText, so the fix must live in the text data).
//
// Three ASCII punctuation characters, each transformed only when FINAL
// ("final" = followed by whitespace or end-of-string). This leaves embedded
// punctuation (3.14, a,b,c, 1,000, a;b, file.txt) untouched.
//
//   - Comma     "," (U+002C) => REPLACED with Arabic comma ، (U+060C) AND
//                the active RTL mark appended. Rationale: U+060C is bidi
//                class CS (neutral — the SAME class as the ASCII comma), so
//                the replacement ALONE is not strongly RTL and still
//                misplaces; the mark is required to anchor it RTL. (Gus's
//                observation: the Arabic comma "does not have the same
//                Bidi-Class as the semicolon". Empirically verified
//                2026-07-03: comma-replacement-without-mark does NOT fix the
//                misplaced comma; adding the mark DOES.)
//   - Semicolon ";" (U+003B) => REPLACED with Arabic semicolon ؛ (U+061B),
//                NO mark. U+061B is bidi class AL (strongly RTL), so unlike
//                the comma it needs no mark.
//   - Period    "." (U+002E) & ellipsis "…" (U+2026) => active RTL mark
//                appended (no Arabic replacement character exists).
//
// IDEMPOTENT, naturally: once a final period/ellipsis is followed by the
// mark, it is no longer "final" (the mark is not whitespace), so a second
// pass won't re-mark it; and the ASCII comma/semicolon are consumed by the
// one-pass replacement. No negative lookahead is required (any directional
// mark, RLM or ALM, makes the punctuation non-final). This matters for code
// paths that round-trip text through getText()/setText()
// (readingAddons getWidestTextWidth).
//
// The active mode is module-level state, set once per condition from the
// EasyEyes layer (components/fonts.js:setFontGlobalState). It is read at
// render time inside TextStim.getText(), so persistent stimuli always use
// the CURRENT condition's value when they next draw. Default "none" =>
// identity, i.e. ZERO behavior change for experiments that do not opt in.

const MARKS = {
  RLM: "\u200F", // RIGHT-TO-LEFT MARK
  ALM: "\u061C", // ARABIC LETTER MARK
};

let mode = "none";

/**
 * Set the active fontPunctuationRTL mode. Any value other than "RLM" or "ALM"
 * (including "none", undefined, null, or a typo) normalizes to "none".
 * @param {string} m
 */
export const setPunctuationRTL = (m) => {
  mode = m in MARKS ? m : "none";
};

/** @returns {string} the active mode ("none" | "RLM" | "ALM") */
export const getPunctuationRTL = () => mode;

/**
 * Apply the fontPunctuationRTL transforms to FINAL punctuation (followed by
 * whitespace or end-of-string):
 *   - Replace FINAL ASCII comma     with Arabic comma ، + the active mark.
 *   - Replace FINAL ASCII semicolon with Arabic semicolon ؛ (no mark).
 *   - Append the active mark after FINAL periods and ellipses (U+2026).
 *
 * Idempotent (see file header). Embedded punctuation is left untouched.
 *
 * @param {string} text
 * @param {string} [m=mode] override; defaults to the module-level mode
 * @returns {string}
 */
export const applyPunctuationRTL = (text, m = mode) => {
  const mark = MARKS[m];
  if (!mark || text == null) return text;
  return String(text)
    // Comma: FINAL ASCII comma → Arabic comma ، + the active mark.
    // U+060C is bidi class CS (neutral, like the ASCII comma), so the mark is
    // still required to anchor it RTL — the replacement alone misplaces.
    .replace(/,(?=\s|$)/g, `\u060C${mark}`)
    // Semicolon: FINAL ASCII semicolon → Arabic semicolon ؛.
    // U+061B is bidi class AL (strongly RTL); no mark needed.
    .replace(/;(?=\s|$)/g, "\u061B")
    // Period: append the mark after FINAL periods.
    .replace(/\.(?=\s|$)/g, `.${mark}`)
    // Ellipsis: append the mark after FINAL ellipses (U+2026).
    .replace(/\u2026(?=\s|$)/g, `\u2026${mark}`);
};
