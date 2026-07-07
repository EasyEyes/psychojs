// Persist Canvas 2D-context state across canvas resizes.
// Per HTML §4.12.5.1, assigning canvas.width/height resets ALL 2D-context
// state. PIXI's updateText() resizes its canvas to fit the text and re-applies
// only a subset (NOT direction, NOT fontKerning). We re-apply our state by
// overriding the instance's width/height accessors and restoring after each
// resize. Per-instance, idempotent, merges across calls (direction + kerning
// share one store).

const STATE = "_eeCtxState";
const PATCHED = "_eeCtxStatePatched";

/** Re-apply this canvas's stored context state. No-op if none stored yet. */
function reapply(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const state = canvas[STATE];
  if (!state) return;
  for (const key of Object.keys(state)) {
    const value = state[key];
    try {
      ctx[key] = value;
    } catch (_e) {
      // Unsupported ctx prop (e.g. Safari fontKerning): skip.
    }
  }
}

/**
 * Keep the given 2D-context state alive on this canvas across resizes.
 * `state`: ctx-property → value pairs. Multiple calls merge (direction +
 * kerning coexist). Re-callable; idempotent. Non-standard canvases (test
 * mocks) degrade to a one-shot apply.
 */
export function persistCanvasContextState(canvas, state) {
  canvas[STATE] = Object.assign(canvas[STATE] || {}, state);
  if (!canvas[PATCHED]) {
    for (const prop of ["width", "height"]) {
      // Walk the prototype chain to find the real accessor, so the instance
      // override can delegate reads/writes.
      let proto = Object.getPrototypeOf(canvas);
      let desc;
      while (proto && !(desc = Object.getOwnPropertyDescriptor(proto, prop))) {
        proto = Object.getPrototypeOf(proto);
      }
      if (!desc || !desc.get || !desc.set) continue; // non-standard canvas
      Object.defineProperty(canvas, prop, {
        configurable: true,
        get() {
          return desc.get.call(this);
        },
        set(v) {
          desc.set.call(this, v); // resize — resets ctx state
          reapply(this);
        },
      });
    }
    canvas[PATCHED] = true;
  }
  reapply(canvas);
}

/** Apply fontKerning to a text canvas, kept alive across resizes. Falsy → "auto". */
export function applyKerningAcrossResizes(canvas, kerning) {
  persistCanvasContextState(canvas, { fontKerning: kerning || "auto" });
}

/**
 * Apply writing direction to a text canvas, kept alive across resizes.
 * textAlign forced to "left": PIXI draws left-anchored, so the default "start"
 * would flip to the right edge under rtl and push text off-canvas.
 */
export function applyDirectionAcrossResizes(canvas, direction, lang) {
  persistCanvasContextState(canvas, {
    direction,
    textAlign: "left",
    ...("lang" in canvas.getContext("2d") ? { lang } : {}),
  });
}
