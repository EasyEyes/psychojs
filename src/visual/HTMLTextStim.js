/**
 * HTMLTextStim — DOM-overlay text stim for instruction-class text.
 *
 * Unlike TextStim (PIXI.Text on canvas, single style), HTMLTextStim renders
 * into a DOM layer above the renderer canvas, enabling rich text (inline
 * bold/italic/spans) and correct bidi/wrapping via the browser's layout
 * engine. Rich rendering is opt-in via the injected `textRenderer`
 * (text → HTML string); the default renderer is safe plain text.
 *
 * Deliberately NOT integrated with the frame render loop: DOM is
 * self-rendering. `_needUpdate` is always false; `autoDraw` toggles CSS
 * visibility. Lifecycle is tied to the Window: stims live in
 * `win._htmlTextLayer`, which Window.close() removes.
 *
 * @name module:visual.HTMLTextStim
 * @class
 * @param {Object} options
 * @param {module:core.Window} options.win - the Window (owns the overlay layer)
 * @param {string} [options.name] - name for logging
 * @param {string} [options.text=""] - text content (passed through textRenderer)
 * @param {function(string): string} [options.textRenderer] - text → HTML
 *   renderer (e.g. a Markdown renderer). Default: safe plain text.
 * @param {string} [options.font] - font family
 * @param {string} [options.units="pix"] - position units (pix | norm | height)
 * @param {number[]} [options.pos=[0,0]] - position in `units`
 * @param {number} [options.height=25] - font size in `units` (pt if
 *   isInstruction, px otherwise — TextStim instruction convention)
 * @param {boolean} [options.isInstruction=false] - pt vs px font size,
 *   mirroring TextStim._getTextStyle
 * @param {number} [options.wrapWidth] - max line width in `units`
 * @param {string} [options.alignHoriz="center"] - left | center | right
 * @param {string} [options.alignVert="center"] - top | center | bottom
 * @param {*} [options.color] - css color string or Color-like ({hex})
 * @param {number} [options.opacity=1]
 * @param {boolean} [options.autoDraw=false]
 * @param {string} [options.direction="ltr"] - ltr | rtl
 * @param {string} [options.language] - BCP-47 tag for the lang attribute
 */
import { to_px } from "../util/Util.js";

// PsychoJS.Status values without importing core/PsychoJS.js (which drags in
// ExperimentHandler → xlsx): Status uses the global symbol registry.
const STATUS_NOT_STARTED = Symbol.for("NOT_STARTED");
const STATUS_STARTED = Symbol.for("STARTED");

const HTML_TEXT_LAYER_ID = "ee-html-text-layer";
// Below SweetAlert2 (1060); above the canvas.
const LAYER_Z_INDEX = "10";

// Reposition all live stims on viewport changes (resize / fullscreen toggle).
const liveStims = new Set();
let listenersAttached = false;
const repositionAll = () => liveStims.forEach((s) => s._reposition());
const attachGlobalListeners = () => {
  if (listenersAttached) return;
  window.addEventListener("resize", repositionAll);
  window.addEventListener("fullscreenchange", repositionAll);
  listenersAttached = true;
};

const ANCHOR_X = { left: 0, center: -50, right: -100 };
const ANCHOR_Y = { top: 0, center: -50, bottom: -100 };

export class HTMLTextStim {
  constructor({
    win,
    name = "htmlTextStim",
    text = "",
    textRenderer = undefined,
    font = "inherit",
    units = "pix",
    pos = [0, 0],
    height = 25,
    isInstruction = false,
    wrapWidth = undefined,
    alignHoriz = "center",
    alignVert = "center",
    color = "#000000",
    opacity = 1.0,
    autoDraw = false,
    direction = "ltr",
    language = undefined,
  } = {}) {
    this._win = win;
    this.name = name;
    this._name = name;
    this._textRenderer = textRenderer;
    this._units = units;
    this._pos = pos;
    this._isInstruction = isInstruction;
    this._alignHoriz = alignHoriz;
    this._alignVert = alignVert;
    this._disposed = false;

    // TextStim-compatible surface. DOM updates synchronously → never needs
    // a flip; status uses the shared PsychoJS.Status symbols.
    this._needUpdate = false;
    this.status = STATUS_NOT_STARTED;
    this.frameNStart = undefined;
    this.tStart = undefined;

    const el = document.createElement("div");
    el.className = "ee-html-text-stim";
    el.dataset.name = this.name;
    const s = el.style;
    s.position = "absolute";
    s.margin = "0";
    s.userSelect = "none";
    s.pointerEvents = "none";
    // Canvas parity: preserve significant whitespace runs (phrase bullet
    // lines use 8-space indents) while still wrapping normally.
    s.whiteSpace = "break-spaces";
    s.width = "max-content";
    s.fontFamily = font;
    s.textAlign = alignHoriz;
    this._el = el;

    this.setHeight(height, isInstruction);
    this.setAlign(alignHoriz, alignVert);
    this.setColor(color);
    this.setOpacity(opacity);
    this.setDirection(direction, language);
    if (typeof wrapWidth !== "undefined") this.setWrapWidth(wrapWidth);
    this.setText(text);

    HTMLTextStim._getLayer(win).appendChild(el);
    liveStims.add(this);
    attachGlobalListeners();
    this._reposition();
    this.setAutoDraw(autoDraw);
  }

  /**
   * The Window-owned overlay layer (lazily created, removed by Window.close).
   * @returns {HTMLElement}
   */
  static _getLayer(win) {
    if (win._htmlTextLayer && document.body.contains(win._htmlTextLayer)) {
      return win._htmlTextLayer;
    }
    const layer = document.createElement("div");
    layer.id = HTML_TEXT_LAYER_ID;
    const s = layer.style;
    s.position = "fixed";
    s.inset = "0";
    s.overflow = "hidden";
    s.pointerEvents = "none";
    s.zIndex = LAYER_Z_INDEX;
    document.body.appendChild(layer);
    win._htmlTextLayer = layer;
    return layer;
  }

  /** Horizontal length in this stim's units → px. */
  _getHorLengthPix(len) {
    return to_px([len, 0], this._units, this._win)[0];
  }

  /**
   * PsychoJS units (center-origin, y-up) → CSS px (viewport, y-down),
   * via the renderer canvas rect (letterbox-safe).
   */
  _reposition() {
    if (this._disposed) return;
    // Window.close() nulls _renderer; resize/fullscreenchange may still fire
    // afterwards (e.g. exiting fullscreen at quit).
    if (!this._win._renderer) return;
    const rect = this._win._renderer.view.getBoundingClientRect();
    const [x, y] = to_px(this._pos, this._units, this._win);
    this._el.style.left = `${rect.left + rect.width / 2 + x}px`;
    this._el.style.top = `${rect.top + rect.height / 2 - y}px`;
  }

  setText(text) {
    if (this._textRenderer) {
      this._el.innerHTML = this._textRenderer(text ?? "");
    } else {
      this._el.textContent = text ?? "";
    }
  }

  setPos(pos) {
    this._pos = pos;
    this._reposition();
  }

  setAlign(alignHoriz, alignVert) {
    this._alignHoriz = alignHoriz;
    this._alignVert = alignVert;
    this._el.style.transform = `translate(${ANCHOR_X[alignHoriz] ?? -50}%, ${
      ANCHOR_Y[alignVert] ?? -50
    }%)`;
    this._el.style.textAlign = alignHoriz;
  }

  setAlignHoriz(alignHoriz) {
    this.setAlign(alignHoriz, this._alignVert);
  }

  setFont(font) {
    this._el.style.fontFamily = font;
  }

  setHeight(height, isInstruction = this._isInstruction) {
    // TextStim instruction convention: pt for instructions, px otherwise.
    const px = Math.round(this._getHorLengthPix(height));
    this._el.style.fontSize = `${px}${isInstruction ? "pt" : "px"}`;
  }

  setWrapWidth(wrapWidth) {
    const px = this._getHorLengthPix(wrapWidth);
    // TextStim convention: wrapWidth Infinity means "never wrap".
    this._el.style.maxWidth = Number.isFinite(px) ? `${px}px` : "none";
  }

  setColor(color) {
    // Accepts css string or Color-like ({hex}) from util.Color.
    const css = typeof color === "string" ? color : color?.hex ?? "#000000";
    this._el.style.color = css;
  }

  setOpacity(opacity) {
    this._el.style.opacity = String(opacity);
  }

  setDirection(direction, language = undefined) {
    this._el.setAttribute("dir", direction);
    if (language) this._el.setAttribute("lang", language);
  }

  setAutoDraw(autoDraw) {
    this._autoDraw = autoDraw;
    this.status = autoDraw ? STATUS_STARTED : STATUS_NOT_STARTED;
    this._el.style.display = autoDraw ? "" : "none";
  }

  /**
   * Rendered size in px (CSS pixels === pix units).
   * @returns {{width: number, height: number}}
   */
  getBoundingBox() {
    const rect = this._el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    liveStims.delete(this);
    this._el.remove();
  }
}
