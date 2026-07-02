// fontPunctuationRTL support.
//
// Handles RTL punctuation for Arabic/Urdu/Persian text rendered to a canvas
// (where HTML dir/CSS direction do not apply — reading text is rasterized via
// PIXI.Text -> Canvas 2D fillText, so the fix must live in the text data).
//
// Three punctuation marks, two strategies (per Denis Pelli + glossary):
//   - Comma     "," (U+002C) => REPLACED with Arabic comma ، (U+060C)
//   - Semicolon ";" (U+003B) => REPLACED with Arabic semicolon ؛ (U+061B)
//   - Period    "." (U+002E) => RTL mark appended
// All three are FINAL-ONLY (followed by whitespace or end-of-string), so
// embedded punctuation (3.14, a,b,c, 1,000, a;b) is left untouched.
//
// Why comma/semicolon are replaced but period is marked: the mark-after
// approach worked for the period but empirically FAILED for the comma (same
// bidi class CS — reason unexplained, likely font glyph positioning). The
// Arabic comma ، and semicolon ؛ are the agreed RTL substitutes. No Arabic
// period exists, so the period keeps the mark (which works).
//
// The active mode is module-level state, set once per condition from the
// EasyEyes layer (components/fonts.js:setFontGlobalState). It is read at
// render time inside TextStim.getText(), so persistent stimuli always use the
// CURRENT condition's value when they next draw. Default "none" => identity,
// i.e. ZERO behavior change for experiments that do not opt in.

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
 * Apply the fontPunctuationRTL transforms: replace FINAL ASCII comma/semicolon
 * with their Arabic counterparts, and append the active RTL mark after FINAL
 * periods. All three are final-only (followed by whitespace or end-of-string).
 *
 * Idempotent: Arabic comma/semicolon aren't ASCII, so re-running the
 * replacements is a no-op; and the RLM/ALM mark is not whitespace, so a period
 * already followed by the mark won't be re-marked. Important for code paths
 * that round-trip text through getText()/setText() (readingAddons
 * getWidestTextWidth).
 *
 * @param {string} text
 * @param {string} [m=mode] override; defaults to the module-level mode
 * @returns {string}
 */
export const applyPunctuationRTL = (text, m = mode) => {
  const mark = MARKS[m];
  if (!mark || text == null) return text;
  // All three are FINAL-ONLY (followed by whitespace or end-of-string), so
  // embedded punctuation in numbers/lists (3.14, a,b,c, 1,000, a;b) is left
  // untouched. Comma/semicolon are REPLACED (mark-after failed empirically);
  // the period keeps the mark (which works; no Arabic period exists).
  return String(text)
    .replace(/([,])(?=\s|$)/g, "\u060C") // final , → ، (Arabic comma)
    .replace(/([;])(?=\s|$)/g, "\u061B") // final ; → ؛ (Arabic semicolon)
    .replace(/(\.)(?=\s|$)/g, `$1${mark}`); // final . → append RTL mark
};
