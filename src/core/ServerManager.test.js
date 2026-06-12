import { jest, expect, describe, test, beforeEach, afterEach } from "@jest/globals";

jest.mock("./GUI.js", () => ({
  GUI: class {
    displayMessage() {}
    dialog() {}
  },
}));

jest.mock("./retryablePavloviaPost.js", () => ({
  _retryablePavloviaPost: jest.fn(),
}));

import { ServerManager } from "./ServerManager.js";
import { _retryablePavloviaPost as retryPost } from "./retryablePavloviaPost.js";

const mockRetryablePavloviaPost = retryPost;

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
  mockRetryablePavloviaPost.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── uploadData async path ─────────────────────────────────────────────────

describe("ServerManager.uploadData — async path", () => {
  test("calls _retryablePavloviaPost with the results URL and data", async () => {
    mockRetryablePavloviaPost.mockResolvedValueOnce({ status: 200 });
    const sm = makeStub();

    await sm.uploadData("results.csv", "col\nval");

    expect(mockRetryablePavloviaPost).toHaveBeenCalledTimes(1);
    const [url, data] = mockRetryablePavloviaPost.mock.calls[0];
    expect(url).toContain("/sessions/tok123/results");
    expect(data).toMatchObject({ key: "results.csv", value: "col\nval" });
  });

  test("sets status READY and resolves on success", async () => {
    mockRetryablePavloviaPost.mockResolvedValueOnce({ status: 200 });
    const sm = makeStub();

    const result = await sm.uploadData("k", "v");

    expect(sm.setStatus).toHaveBeenCalledWith(ServerManager.Status.READY);
    expect(result).toMatchObject({ origin: "ServerManager.uploadData" });
  });

  test("sets status ERROR and rejects on non-retryable failure", async () => {
    const cause = Object.assign(new Error("forbidden"), { status: 403 });
    mockRetryablePavloviaPost.mockRejectedValueOnce(cause);
    const sm = makeStub();

    await expect(sm.uploadData("k", "v")).rejects.toMatchObject({
      origin: "ServerManager.uploadData",
    });
    expect(sm.setStatus).toHaveBeenCalledWith(ServerManager.Status.ERROR);
  });
});

// ─── uploadData sync path (sendBeacon, untouched) ─────────────────────────

describe("ServerManager.uploadData — sync path", () => {
  test("does not call _retryablePavloviaPost when sync=true", async () => {
    const sm = makeStub();
    global.navigator = { sendBeacon: jest.fn() };

    sm.uploadData("k", "v", true);

    expect(mockRetryablePavloviaPost).not.toHaveBeenCalled();
    expect(global.navigator.sendBeacon).toHaveBeenCalledTimes(1);

    delete global.navigator;
  });
});

// ─── uploadLog ─────────────────────────────────────────────────────────────

describe("ServerManager.uploadLog", () => {
  test("calls _retryablePavloviaPost with the logs URL and data", async () => {
    mockRetryablePavloviaPost.mockResolvedValueOnce({ status: 200 });
    const sm = makeStub();

    await sm.uploadLog("log-content", false);

    expect(mockRetryablePavloviaPost).toHaveBeenCalledTimes(1);
    const [url, data] = mockRetryablePavloviaPost.mock.calls[0];
    expect(url).toContain("/sessions/tok123/logs");
    expect(data).toMatchObject({ logs: "log-content" });
  });

  test("sets status READY and resolves on success", async () => {
    mockRetryablePavloviaPost.mockResolvedValueOnce({ status: 200 });
    const sm = makeStub();

    const result = await sm.uploadLog("log", false);

    expect(sm.setStatus).toHaveBeenCalledWith(ServerManager.Status.READY);
    expect(result).toMatchObject({ origin: "ServerManager.uploadLog" });
  });

  test("sets status ERROR and rejects on non-retryable failure", async () => {
    const cause = Object.assign(new Error("gateway timeout"), { status: 504 });
    mockRetryablePavloviaPost.mockRejectedValueOnce(cause);
    const sm = makeStub();

    await expect(sm.uploadLog("log", false)).rejects.toMatchObject({
      origin: "ServerManager.uploadLog",
    });
    expect(sm.setStatus).toHaveBeenCalledWith(ServerManager.Status.ERROR);
  });
});
