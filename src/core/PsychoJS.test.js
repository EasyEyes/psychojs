import { jest, expect, describe, test, beforeAll } from "@jest/globals";

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
  instance._serverManager = { closeSession: jest.fn().mockResolvedValue(undefined) };

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

// ── adversarial findings from the save-orchestration collapse ───────────────
import { ExperimentHandler } from "../data/ExperimentHandler.js";

describe("PsychoJS.quit() — teardown must wait for the save", () => {
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
