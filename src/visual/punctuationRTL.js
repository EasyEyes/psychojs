// fontPunctuationRTL support.
//
// Inserts an invisible zero-width RTL mark (RLM U+200F or ALM U+061C) after
// each FINAL ASCII comma "," or period "." so the Unicode bidirectional
// algorithm treats that punctuation as right-to-left. This fixes the
// "occasional comma/period jumps to the wrong side" glitch in Arabic, Persian,
// and Urdu text rendered to a canvas (where HTML dir/CSS direction do not
// apply — the reading text is rasterized via PIXI.Text -> Canvas 2D
// fillText, so the bidi hint must live in the text data itself).
//
// The active mode is module-level state, set once per condition from the
// EasyEyes layer (components/fonts.js:setFontGlobalState). It is read at
// render time inside TextStim.getText(), so persistent stimuli always use the
// CURRENT condition's value when they next draw (more robust than capturing
// the mode at TextStim construction time). Default "none" => identity, i.e.
// ZERO behavior change for experiments that do not opt in.
//
// Spec (EasyEyes glossary, "fontPunctuationRTL"):
//   - none  : do nothing
//   - RLM   : U+200F RIGHT-TO-LEFT MARK
//   - ALM   : U+061C ARABIC LETTER MARK (recommended for Arabic/Urdu/Persian)
// "Final" = followed by whitespace OR at end of string. Only ASCII
// "," (U+002C) and "." (U+002E) are affected; the Arabic comma "،" (U+060C)
// is already unambiguously RTL and is left untouched, as are embedded
// punctuation like "3.14" or "a,b,c".

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
 * Insert the active (or explicitly-specified) RTL mark after each FINAL ASCII
 * comma or period. "Final" = followed by whitespace OR end of string.
 *
 * The lookahead does not consume the trailing whitespace, and RLM/ALM are not
 * whitespace themselves (bidi marks, not \s), so repeated application is
 * idempotent — important for code paths that round-trip text through
 * getText()/setText() (e.g. readingAddons getWidestTextWidth).
 *
 * @param {string} text
 * @param {string} [m=mode] override; defaults to the module-level mode
 * @returns {string}
 */
export const applyPunctuationRTL = (text, m = mode) => {
  const mark = MARKS[m];
  if (!mark || text == null) return text;
  return String(text).replace(/([,.])(?=\s|$)/g, `$1${mark}`);
};
