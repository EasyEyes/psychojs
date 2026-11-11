import { jest, expect, describe, test, beforeAll, afterEach } from "@jest/globals";

// GUI.js imports files outside the psychojs package that don't exist in this
// test context (../../../components/global.js, ../../../threshold.js).
// Mock it so the import chain doesn't fail.
jest.unstable_mockModule("./GUI.js", () => ({
  GUI: class {
    displayMessage() {}
    dialog() {}
  },
}));

let PsychoJS;
beforeAll(async () => {
  ({ PsychoJS } = await import("./PsychoJS.js"));
});

function makeQuitStub({ saveIncompleteResults = false } = {}) {
  const instance = Object.create(PsychoJS.prototype);
  const save = jest.fn().mockResolvedValue(undefined);

  instance._experiment = {
    experimentEnded: false,
    save,
    saveCSV: jest.fn(),
    addData: jest.fn(),
    _dataFileName: "test-results",
    _trialsData: [],
  };
  instance._status = null;
  instance._scheduler = { stop: jest.fn() };
  // environment undefined → not SERVER → skips window.removeEventListener / closeSession
  instance._config = {
    environment: undefined,
    experiment: { saveIncompleteResults },
  };
  instance._serverMsg = { has: jest.fn().mockReturnValue(false) };
  // logger getter returns _logger.consoleLogger; _logger.flush() is called directly
  instance._logger = {
    consoleLogger: { info: jest.fn() },
    flush: jest.fn().mockResolvedValue(undefined),
  };
  // gui getter returns _gui, so set _gui directly (gui is read-only)
  instance._gui = { displayMessage: jest.fn(), dialog: jest.fn() };
  instance._serverManager = {
    closeSession: jest.fn().mockResolvedValue(undefined),
    uploadData: jest.fn().mockResolvedValue(undefined),
  };

  return { instance, save };
}

describe("PsychoJS.quit() skipSave option", () => {
  test("skipSave:true suppresses experiment.save() even when isCompleted:true", async () => {
    const { instance, save } = makeQuitStub();

    await instance.quit({ isCompleted: true, skipSave: true });

    expect(save).not.toHaveBeenCalled();
  });

  test("skipSave:false (default) calls experiment.save() when isCompleted:true", async () => {
    const { instance, save } = makeQuitStub();

    await instance.quit({ isCompleted: true });

    expect(save).toHaveBeenCalledTimes(1);
  });

  test("skipSave:true still shows the finished screen", async () => {
    const { instance } = makeQuitStub();

    await instance.quit({ isCompleted: true, skipSave: true });

    expect(instance._gui.displayMessage).toHaveBeenCalled();
  });
});

describe("PsychoJS.quit() doNotCloseMessage suppression", () => {
  // threshold renders its own saving indicator over the page; a second wait
  // message underneath would double-render.
  test("doNotCloseMessage:'' skips the wait message but still shows the finished screen", async () => {
    const { instance } = makeQuitStub();

    await instance.quit({ isCompleted: true, doNotCloseMessage: "" });

    // exactly one displayMessage: the finished screen — no wait message
    expect(instance._gui.displayMessage).toHaveBeenCalledTimes(1);
  });

  test("default doNotCloseMessage shows the wait message, then the finished screen", async () => {
    const { instance } = makeQuitStub();

    await instance.quit({ isCompleted: true });

    expect(instance._gui.displayMessage).toHaveBeenCalledTimes(2);
    expect(instance._gui.displayMessage.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        warning: expect.stringContaining("DO NOT CLOSE"),
      }),
    );
  });
});

describe("PsychoJS.quit() — finalSaveOutcomeJSON", () => {
  const serverEnvironment = (instance) => {
    instance._config.environment = ExperimentHandler.Environment.SERVER;
    instance._config.experiment.status = "RUNNING";
    globalThis.window = {
      removeEventListener: jest.fn(),
      addEventListener: jest.fn(),
    };
  };

  afterEach(() => {
    delete globalThis.window;
  });

  test("CSV, log, and session-close successes are written to one cumulative sidecar", async () => {
    const { instance } = makeQuitStub();
    serverEnvironment(instance);

    await instance.quit({ isCompleted: true });

    const calls = instance._serverManager.uploadData.mock.calls.filter(
      ([key]) => key === "test-results.finalSaveOutcome.json",
    );
    expect(calls.length).toBeGreaterThan(0);
    const outcome = JSON.parse(calls[calls.length - 1][1]);
    expect(outcome).toMatchObject({
      version: 1,
      csvUpload: { status: "succeeded", attempts: 1 },
      logUpload: { status: "succeeded", attempts: 1 },
      sessionClose: { status: "succeeded", attempts: 1 },
    });
    expect(instance._experiment.addData).toHaveBeenCalledWith(
      "finalSaveOutcomeJSON",
      expect.any(String),
    );
  });

  test("a failed log and its log-only recovery are both recorded without another results CSV save", async () => {
    const { instance, save } = makeQuitStub();
    serverEnvironment(instance);
    const logFailure = new Error("Log upload failed");
    instance._logger.flush
      .mockRejectedValueOnce(logFailure)
      .mockResolvedValueOnce(undefined);

    await expect(instance.quit({ isCompleted: true })).rejects.toBe(logFailure);
    const { onOK } = instance._gui.dialog.mock.calls[0][0];
    await onOK();

    const outcomes = instance._serverManager.uploadData.mock.calls
      .filter(([key]) => key === "test-results.finalSaveOutcome.json")
      .map(([, value]) => JSON.parse(value));
    expect(outcomes.some((o) => o.logUpload.status === "failed")).toBe(true);
    expect(outcomes[outcomes.length - 1].logUpload.status).toBe("succeeded");
    // The audit persists across quit() calls: the retry is the second
    // attempt on the SAME stage, and csvUpload is not re-attempted.
    expect(outcomes[outcomes.length - 1].logUpload).toMatchObject({
      status: "succeeded",
      attempts: 2,
    });
    expect(outcomes[outcomes.length - 1].csvUpload).toMatchObject({
      status: "succeeded",
      attempts: 1,
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("finalSaveOutcomeJSON is stamped onto the last committed row (rescue re-save carrier)", async () => {
    const { instance } = makeQuitStub();
    instance._config.environment = ExperimentHandler.Environment.SERVER;
    instance._config.experiment.status = "RUNNING";
    globalThis.window = { removeEventListener: jest.fn(), addEventListener: jest.fn() };
    instance._experiment._trialsData = [{ experimentCompleteBool: true }];

    try {
      await instance.quit({ isCompleted: true });

      const lastRow = instance._experiment._trialsData[0];
      expect(lastRow.finalSaveOutcomeJSON).toBeDefined();
      expect(JSON.parse(lastRow.finalSaveOutcomeJSON)).toMatchObject({
        csvUpload: { status: "succeeded" },
        logUpload: { status: "succeeded" },
        sessionClose: { status: "succeeded" },
      });
    } finally {
      delete globalThis.window;
    }
  });

  test("the uploaded results CSV never carries a stale inProgress outcome", async () => {
    const { instance } = makeQuitStub();
    serverEnvironment(instance);
    instance._experiment._trialsData = [{ experimentCompleteBool: true }];
    let committedAtSave;
    instance._experiment.save.mockImplementation(function () {
      committedAtSave = { ...this._trialsData[0] };
      return Promise.resolve();
    });

    await instance.quit({ isCompleted: true });

    // The upload happens during save(): whatever outcome state it carries is
    // frozen in the downloaded CSV forever. It must not claim inProgress —
    // final states live in the sidecar and the post-finish stamp.
    expect(committedAtSave.finalSaveOutcomeJSON).toBeUndefined();
    expect(
      JSON.parse(instance._experiment._trialsData[0].finalSaveOutcomeJSON),
    ).toMatchObject({ csvUpload: { status: "succeeded" } });
  });

  test("outcome-sidecar failure never blocks normal completion", async () => {
    const { instance } = makeQuitStub();
    serverEnvironment(instance);
    instance._serverManager.uploadData.mockRejectedValue(
      new Error("metadata upload unavailable"),
    );

    await expect(instance.quit({ isCompleted: true })).resolves.toBeUndefined();
    expect(instance._experiment.experimentEnded).toBe(true);
    expect(instance._gui.displayMessage).toHaveBeenCalled();
  });
});

// ── adversarial findings from the save-orchestration collapse ───────────────
import { ExperimentHandler } from "../data/ExperimentHandler.js";

describe("PsychoJS.quit() — teardown must wait for the save", () => {
  test("a failed final save is tagged csvUpload and never shows the safe-to-close screen", async () => {
    const { instance } = makeQuitStub();
    const uploadFailure = Object.assign(new Error("Gateway Timeout"), {
      status: 504,
    });
    instance._experiment.save.mockRejectedValueOnce(uploadFailure);

    await expect(instance.quit({ isCompleted: true })).rejects.toBe(
      uploadFailure,
    );

    expect(uploadFailure.stage).toBe("csvUpload");
    expect(instance._gui.dialog).toHaveBeenCalledWith({
      error: uploadFailure,
      participantMessageKey: "EE_504UploadError",
      buttonTextKey: "EE_SaveButton",
      onOK: expect.any(Function),
    });
    expect(instance._gui.displayMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("safe to close"),
      }),
    );
    expect(instance._experiment.experimentEnded).toBe(false);
  });

  test("Save retries a completed study's failed result save as completed", async () => {
    const { instance, save } = makeQuitStub();
    const uploadFailure = new Error("Gateway Timeout");
    save.mockRejectedValueOnce(uploadFailure);

    await expect(instance.quit({ isCompleted: true })).rejects.toBe(
      uploadFailure,
    );

    const { onOK } = instance._gui.dialog.mock.calls[0][0];
    await onOK();

    expect(save).toHaveBeenCalledTimes(2);
    expect(instance._experiment.experimentEnded).toBe(true);
  });

  test("an incomplete study's save failure keeps the standard error dialog", async () => {
    const { instance, save } = makeQuitStub();
    const uploadFailure = new Error("Gateway Timeout");
    save.mockRejectedValueOnce(uploadFailure);

    await expect(instance.quit({ isCompleted: false })).rejects.toBe(
      uploadFailure,
    );

    expect(instance._gui.dialog).toHaveBeenCalledWith({ error: uploadFailure });
  });

  test("a failed final log upload offers a log-only Save retry", async () => {
    const { instance } = makeQuitStub();
    const logFailure = Object.assign(new Error("Log upload failed"), {
      status: 504,
    });
    instance._logger.flush.mockRejectedValueOnce(logFailure);

    await expect(instance.quit({ isCompleted: true })).rejects.toBe(logFailure);

    expect(logFailure.stage).toBe("logUpload");
    expect(instance._gui.dialog).toHaveBeenCalledWith(
      expect.objectContaining({
        error: logFailure,
        buttonTextKey: "EE_SaveButton",
        onOK: expect.any(Function),
      }),
    );
    expect(instance._gui.displayMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("safe to close"),
      }),
    );
    expect(instance._experiment.experimentEnded).toBe(false);
  });

  test("log Save retries only the log, not the completed results CSV", async () => {
    const { instance, save } = makeQuitStub();
    const logFailure = new Error("Log upload failed");
    instance._logger.flush
      .mockRejectedValueOnce(logFailure)
      .mockResolvedValueOnce(undefined);

    await expect(instance.quit({ isCompleted: true })).rejects.toBe(logFailure);
    const { onOK } = instance._gui.dialog.mock.calls[0][0];
    await onOK();

    expect(save).toHaveBeenCalledTimes(1);
    expect(instance._logger.flush).toHaveBeenCalledTimes(2);
    expect(instance._experiment.experimentEnded).toBe(true);
  });

  test("a wrapped upload rejection preserves its nested message and stage", async () => {
    const { instance } = makeQuitStub();
    const logFailure = {
      origin: "ServerManager.uploadLog",
      context: "when uploading participant's log",
      error: Object.assign(new Error("Pavlovia POST failed with status 504"), {
        status: 504,
        statusText: "Gateway Timeout",
      }),
    };
    instance._logger.flush.mockRejectedValueOnce(logFailure);

    await expect(instance.quit({ isCompleted: true })).rejects.toBe(logFailure);

    expect(logFailure.stage).toBe("logUpload");
    expect(logFailure.message).toBe("Pavlovia POST failed with status 504");
  });

  test("experimentEnded is set only AFTER the save resolves (a stalled save must not mark the experiment ended)", async () => {
    const { instance } = makeQuitStub();
    let resolveSave = () => {};
    instance._experiment.save.mockImplementation(
      () =>
        new Promise((res) => {
          resolveSave = res;
        }),
    );

    const q = instance.quit({ isCompleted: true });
    await new Promise((r) => setTimeout(r, 0));
    // While the save is stalled, the experiment is NOT ended: a second quit
    // (the participant pressing Escape) must still be allowed to run — the
    // field-observed rescue that saved BoldBronzeSushi187's data.
    expect(instance._experiment.experimentEnded).toBe(false);
    resolveSave();
    await q;
    expect(instance._experiment.experimentEnded).toBe(true);
  });

  test("the beforeunload listener (unload sync-save) is removed only AFTER the save completes", async () => {
    const { instance } = makeQuitStub();
    instance._config.environment =
      ExperimentHandler.Environment.SERVER;
    const removeEventListener = jest.fn();
    globalThis.window = {
      removeEventListener,
      addEventListener: jest.fn(),
    };
    let resolveSave = () => {};
    instance._experiment.save.mockImplementation(
      () =>
        new Promise((res) => {
          resolveSave = res;
        }),
    );

    const q = instance.quit({ isCompleted: true });
    await new Promise((r) => setTimeout(r, 0));
    // Closing the tab mid-save must still fire PsychoJS's unload sync-save —
    // how SpicyBrownCake404's data reached the server in the field.
    expect(removeEventListener).not.toHaveBeenCalled();
    resolveSave();
    await q;
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(removeEventListener.mock.calls[0][0]).toBe("beforeunload");
    delete globalThis.window;
  });

  test("an incomplete session still saves when saveIncompleteResults is false (threshold contract: never skip a save)", async () => {
    const { instance, save } = makeQuitStub({ saveIncompleteResults: false });

    await instance.quit({ isCompleted: false });

    expect(save).toHaveBeenCalledTimes(1);
  });
});
