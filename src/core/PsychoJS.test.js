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
