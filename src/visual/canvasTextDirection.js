// Writing-direction support for canvas-rendered text (fontDirection).

/**
 * Keep the 2D context's writing direction correct on a (PIXI-owned) text
 * canvas ACROSS canvas resizes.
 *
 * Re-callable: on an already-patched canvas it just updates the target state
 * and re-applies it. On a non-standard canvas (e.g. a test mock without
 * width/height accessors) it degrades to a one-shot apply.
 *
 * @param {HTMLCanvasElement} canvas - the canvas whose context to keep in sync
 * @param {"ltr"|"rtl"} direction - bidi base direction for fillText
 * @param {string} lang - BCP-47 language tag for text shaping
 */
export const applyDirectionAcrossResizes = (canvas, direction, lang) => {
  canvas._eeTextState = { direction, lang };
  const apply = () => {
    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const state = canvas._eeTextState;
      ctx.direction = state.direction;
      // PIXI draws left-anchored; default "start" would flip to the right
      // edge under rtl and push the text off-canvas. Harmless under ltr
      // (start === left).
      ctx.textAlign = "left";
      if ("lang" in ctx) ctx.lang = state.lang;
    } catch (e) {
      // ignore: non-standard canvas (e.g. a test mock)
    }
  };
  if (!canvas._eeTextStatePatched) {
    for (const prop of ["width", "height"]) {
      // Find the prototype that owns the accessor (usually
      // HTMLCanvasElement.prototype) so the instance override can delegate.
      let proto = Object.getPrototypeOf(canvas);
      let desc;
      while (proto && !(desc = Object.getOwnPropertyDescriptor(proto, prop))) {
        proto = Object.getPrototypeOf(proto);
      }
      if (!desc || !desc.get || !desc.set) {
        // Non-standard canvas: fall back to the immediate apply() below.
        continue;
      }
      Object.defineProperty(canvas, prop, {
        configurable: true,
        get() {
          return desc.get.call(this);
        },
        set(v) {
          // The actual resize. It resets the 2D context state...
          desc.set.call(this, v);
          // ...so immediately restore direction/textAlign/lang.
          apply();
        },
      });
    }
    canvas._eeTextStatePatched = true;
  }
  apply();
};
