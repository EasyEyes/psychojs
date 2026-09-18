import { jest, expect, describe, test, beforeEach, afterEach } from "@jest/globals";

jest.mock("./GUI.js", () => ({
  GUI: class {
    displayMessage() {}
    dialog() {}
  },
}));

import { ServerManager } from "./ServerManager.js";

const ok = () => ({ status: 200, statusText: "OK", ok: true });

function mockJQueryPost() {
  const callbacks = {};
  const request = {
    done: jest.fn((callback) => {
      callbacks.done = callback;
      return request;
    }),
    fail: jest.fn((callback) => {
      callbacks.fail = callback;
      return request;
    }),
  };
  global.jQuery = { post: jest.fn(() => request) };
  return callbacks;
}

function makeConfig() {
  return {
    pavlovia: { URL: "https://pavlovia.org" },
    experiment: {
      fullpath: "user/exp",
      name: "exp",
    },
    session: { token: "tok123" },
  };
}

function makeStub() {
  const instance = Object.create(ServerManager.prototype);
  instance._psychoJS = {
    config: makeConfig(),
    logger: { debug: jest.fn() },
    experiment: {
      extraInfo: {
        participant: "P1",
        session: "001",
        date: "2026-01-01_12:00",
        expName: "exp",
      },
    },
  };
  // psychoJS getter in PsychObject returns this._psychoJS
  instance._listeners = new Map();
  instance._onceUuids = new Map();
  instance.setStatus = jest.fn();
  return instance;
}

beforeEach(() => {
  global.fetch = jest.fn();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.jQuery;
});

// ─── uploadData async path ─────────────────────────────────────────────────

describe("ServerManager.uploadData — async path", () => {
  test("posts the results URL and data once", async () => {
    const callbacks = mockJQueryPost();
    const sm = makeStub();

    const upload = sm.uploadData("results.csv", "col\nval");
    callbacks.done({ saved: true }, "success");
    await upload;

    expect(global.jQuery.post).toHaveBeenCalledTimes(1);
    const [url, data, callback, dataType] = global.jQuery.post.mock.calls[0];
    expect(url).toContain("/sessions/tok123/results");
    expect(data).toEqual({ key: "results.csv", value: "col\nval" });
    expect(callback).toBeNull();
    expect(dataType).toBe("json");
  });

  test("sets status READY and resolves on success", async () => {
    const callbacks = mockJQueryPost();
    const sm = makeStub();

    const upload = sm.uploadData("k", "v");
    callbacks.done({ saved: true }, "success");
    const result = await upload;

    expect(sm.setStatus).toHaveBeenCalledWith(ServerManager.Status.READY);
    expect(result).toMatchObject({ origin: "ServerManager.uploadData" });
  });

  test("sets status ERROR and rejects on failure", async () => {
    const callbacks = mockJQueryPost();
    const sm = makeStub();

    const upload = sm.uploadData("k", "v");
    callbacks.fail({ status: 403, responseText: "forbidden" }, "error", "Forbidden");

    await expect(upload).rejects.toMatchObject({
      origin: "ServerManager.uploadData",
    });
    expect(sm.setStatus).toHaveBeenCalledWith(ServerManager.Status.ERROR);
  });

  test("formats a 504 exactly as commit 5674d9e6", async () => {
    const callbacks = mockJQueryPost();
    const sm = makeStub();

    const upload = sm.uploadData("results.csv", "data");
    callbacks.fail(
      { status: 504, responseText: "504 Gateway Time-out" },
      "error",
      "Gateway Time-out",
    );

    await expect(upload).rejects.toMatchObject({
      context: "when uploading participant's results for experiment: user/exp",
      error: "504 Gateway Time-out (HTTP 504: error)",
    });
  });
});

// ─── uploadData sync path (sendBeacon, untouched) ─────────────────────────

describe("ServerManager.uploadData — sync path", () => {
  test("does not call fetch when sync=true", async () => {
    const sm = makeStub();
    global.navigator = { sendBeacon: jest.fn() };

    sm.uploadData("k", "v", true);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(global.navigator.sendBeacon).toHaveBeenCalledTimes(1);

    delete global.navigator;
  });
});

// ─── uploadLog ─────────────────────────────────────────────────────────────

describe("ServerManager.uploadLog", () => {
  test("posts the logs URL and data once", async () => {
    global.fetch.mockResolvedValueOnce(ok());
    const sm = makeStub();

    await sm.uploadLog("log-content", false);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain("/sessions/tok123/logs");
    expect(options.body).toContain("logs=log-content");
    expect(options.signal).toBeUndefined();
  });

  test("sets status READY and resolves on success", async () => {
    global.fetch.mockResolvedValueOnce(ok());
    const sm = makeStub();

    const result = await sm.uploadLog("log", false);

    expect(sm.setStatus).toHaveBeenCalledWith(ServerManager.Status.READY);
    expect(result).toMatchObject({ origin: "ServerManager.uploadLog" });
  });

  test("sets status ERROR and rejects on failure", async () => {
    const cause = Object.assign(new Error("gateway timeout"), { status: 504 });
    global.fetch.mockRejectedValueOnce(cause);
    const sm = makeStub();

    await expect(sm.uploadLog("log", false)).rejects.toMatchObject({
      origin: "ServerManager.uploadLog",
    });
    expect(sm.setStatus).toHaveBeenCalledWith(ServerManager.Status.ERROR);
  });
});
