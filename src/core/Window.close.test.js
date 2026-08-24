/**
 * RED: Window.close() crashes with "Cannot read properties of null
 * (reading 'loseContext')" when the WebGL context is already lost.
 *
 * Seen in production: getExtension("WEBGL_lose_context") returns null when
 * the context is already lost (or the extension is unavailable, e.g. some
 * mobile browsers), and close() unconditionally calls extension.loseContext().
 * The error surfaced as an uncaught TypeError during page close, polluting
 * the session's error record.
 *
 * Desired: close() tolerates a missing WEBGL_lose_context extension.
 */
import { expect, describe, test, beforeAll, afterAll } from "@jest/globals";
import { Window } from "./Window.js";

const realDocument = globalThis.document;
const realWindow = globalThis.window;

beforeAll(() => {
  globalThis.document = {
    body: { contains: () => false, removeChild: () => {} },
  };
  globalThis.window = { removeEventListener: () => {} };
});

afterAll(() => {
  globalThis.document = realDocument;
  globalThis.window = realWindow;
});

const fakeWindow = (gl) => ({
  _renderer: {
    view: {},
    gl,
    destroy: () => {},
  },
  _htmlTextLayer: null,
  _resizeCallback: () => {},
});

describe("Window.close with lost/unavailable WebGL context", () => {
  test("getExtension('WEBGL_lose_context') returning null does not throw", () => {
    const self = fakeWindow({ getExtension: () => null });
    expect(() => Window.prototype.close.call(self)).not.toThrow();
    expect(self._renderer).toBe(null);
  });

  test("null gl (context creation failed) does not throw", () => {
    const self = fakeWindow(null);
    expect(() => Window.prototype.close.call(self)).not.toThrow();
    expect(self._renderer).toBe(null);
  });

  test("normal context is still explicitly lost", () => {
    const loseContext = jest.fn();
    const self = fakeWindow({
      getExtension: () => ({ loseContext }),
    });
    Window.prototype.close.call(self);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });
});
