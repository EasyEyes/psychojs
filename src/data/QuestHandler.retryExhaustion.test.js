/**
 * RED: QuestHandler crashes with "Cannot read properties of undefined
 * (reading '0')" when a response is added after the trial sequence is
 * exhausted but the handler was never marked finished.
 *
 * Scenario (seen in production, fatal at trialRoutineEnd):
 * EasyEyes retries bad trials via MultiStairHandler.addTrial(), which does
 * `staircase.nRemaining++` without extending `_trialSequence`. The retry
 * trials themselves call `next(false)` (not given to QUEST), which does NOT
 * decrement nRemaining. So nRemaining stays > 0 when the sequence rolls over
 * to thisRepN = nReps, `_finished` is never set, and the next bad trial calls
 * `next(false)` — which skips the termination guard and reads
 * `_trialSequence[nReps][0]` → undefined[0] → TypeError.
 *
 * Desired: adding a response after exhaustion must not throw; the handler
 * should report finished.
 */
import { expect, describe, test } from "@jest/globals";
import { QuestHandler } from "./QuestHandler.js";

// jsQUEST is a global in the app; a minimal stub suffices — this test
// targets the trial-sequence bookkeeping, not QUEST math.
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

const makeHandler = (nTrials = 2) =>
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

describe("QuestHandler after sequence exhaustion with pending retries", () => {
  test("bad-trial addResponse after exhaustion does not throw", () => {
    const handler = makeHandler(2);
    // Simulate MultiStairHandler.addTrial(): each retry inflates nRemaining
    // without extending the trial sequence. Two retries are enough to keep
    // nRemaining > 0 when the sequence rolls over, so _finished never set.
    handler.nRemaining += 2;

    // Exhaust the sequence with good trials.
    handler.addResponse(1, 0);
    handler.addResponse(1, 0);
    handler.addResponse(1, 0);
    // Sequence exhausted (thisRepN === nReps) but _finished was never set
    // because nRemaining stayed above zero.

    // A bad trial (not given to QUEST) previously crashed here:
    // TypeError: Cannot read properties of undefined (reading '0')
    expect(() =>
      handler.addResponse(0, undefined, false, false),
    ).not.toThrow();
    expect(handler.finished).toBe(true);
  });

  test("good-trial addResponse after exhaustion marks handler finished", () => {
    const handler = makeHandler(2);
    handler.nRemaining += 2;
    handler.addResponse(1, 0);
    handler.addResponse(1, 0);
    handler.addResponse(1, 0);
    expect(() => handler.addResponse(1, 0)).not.toThrow();
    expect(handler.finished).toBe(true);
  });
});
