/**
 * RED→GREEN: the practice flush (thresholdPracticeUntilCorrectBool) must
 * restore the ORIGINAL REQUESTED NUMBER OF TRIALS, per the glossary (SPEC):
 *
 * "After the participant's first correct response in this condition,
 *  EasyEyes flushes Quest for this condition, to start fresh, with the
 *  original prior probability density, AND THE ORIGINAL REQUESTED NUMBER
 *  OF TRIALS."
 *
 * QuestHandler.addResponse signature (as MultiStairHandler calls it):
 *   addResponse(response, value, doAddData, doGiveToQuest, doResetQuest)
 * EasyEyes practice-wrong trial:  addResponse(0, v, false, true)          — given to QUEST, counting
 * EasyEyes flush (first correct): addResponse(1, v, false, true, true)    — reset; pdf never sees it
 * EasyEyes good on-record trial:  addResponse(1, v, false, true)
 *
 * Pre-fix: reset() restored only the pdf; practice trials' counting calls
 * permanently consumed the trial budget, so after the flush the staircase
 * finished early (nRemaining hit 0 at the flush itself) — the
 * trial-sequence-exhaustion mechanism behind the Persian crash.
 */
import { expect, describe, test } from "@jest/globals";
import { QuestHandler } from "./QuestHandler.js";

// jsQUEST is a global in the app; minimal stub — bookkeeping under test.
globalThis.jsQUEST = {
  QuestCreate: () => ({}),
  QuestUpdate: (q) => q,
  QuestSimulate: () => 1,
  QuestQuantile: (q, p) => (typeof p === "number" ? p : 0),
  QuestMean: () => 0,
  QuestMode: () => 0,
  QuestSd: () => 100,
  QuestBetaAnalysis: () => {},
};

const mockPsychoJS = {
  serverManager: { getResource: () => {} },
  experiment: { addData: () => {} },
  logger: { debug: () => {}, warn: () => {} },
};

const makeHandler = (nTrials = 3) =>
  new QuestHandler({
    psychoJS: mockPsychoJS,
    varName: "trialsVal",
    startVal: 0,
    startValSd: 1,
    minVal: -3,
    maxVal: 1,
    pThreshold: 0.82,
    nTrials,
    name: "testQuest",
    autoLog: false,
  });

describe("practice flush restores the original requested number of trials", () => {
  test("flush does not finish the staircase and leaves the full budget", () => {
    const N = 3;
    const handler = makeHandler(N);

    // Two practice trials: wrong but given to QUEST (counting consumption).
    handler.addResponse(0, 0, false, true);
    handler.addResponse(0, 0, false, true);

    // Flush: first correct response.
    handler.addResponse(1, 0, false, true, true);

    // SPEC: after the flush the staircase must be alive with the ORIGINAL
    // requested number of trials. Pre-fix: nRemaining hit 0 here and
    // _finished became true at the flush itself.
    expect(handler.finished).toBe(false);
    expect(handler.nRemaining).toBe(N);

    // All N on-record trials fit — no rollover, exact consumption.
    let rolledOver = false;
    for (let i = 0; i < N; i++) {
      handler.addResponse(1, 0, false, true);
      if (handler.thisRepN >= handler.nReps) rolledOver = true;
    }
    expect(rolledOver).toBe(false);
    expect(handler.thisN).toBe(N); // flush trial not counted (practice)
    expect(handler.nRemaining).toBe(0);
  });

  test("reset() homes the iterator to its pre-first-trial state", () => {
    const handler = makeHandler(3);
    handler.addResponse(0, 0, false, true); // consume one slot
    handler.reset();
    expect(handler.thisTrialN).toBe(-1); // constructor's "not started" state
    expect(handler.thisRepN).toBe(0);
    expect(handler.thisN).toBe(0);
    expect(handler.nRemaining).toBe(handler.nTotal);
    expect(handler.finished).toBe(false);
  });
});
