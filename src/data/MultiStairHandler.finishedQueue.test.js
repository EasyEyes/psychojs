/**
 * RED: MultiStairHandler._nextTrial must never select a FINISHED staircase
 * from the trialKey retry queue.
 *
 * Scenario: FULL_RANDOM method, two conditions. Condition A finished (trial
 * sequence rolled over) while retry entries for A were still queued (bad
 * trials retried via addTrial earlier). When the pass is rebuilt, the queue
 * is shuffled and shifted; the lookup finds the handler BY NAME only —
 * without a finished check — so the finished staircase A is selected again
 * and the participant is shown spurious trials for a completed condition,
 * whose responses are then silently ignored by the finished QuestHandler.
 *
 * Desired: queued entries for finished staircases are void; the next trial
 * comes from an unfinished staircase (B).
 */
import { expect, describe, test } from "@jest/globals";
import { MultiStairHandler } from "./MultiStairHandler.js";
import { TrialHandler } from "./TrialHandler.js";

// jsQUEST is a global in the app; minimal stub — sequence bookkeeping only.
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

const makeMulti = () =>
  new MultiStairHandler({
    psychoJS: mockPsychoJS,
    varName: "trialsVal",
    stairType: MultiStairHandler.StaircaseType.QUEST,
    conditions: [
      { label: "1_1", startVal: -1, startValSd: 0.5, pThreshold: 0.82, nTrials: 2 },
      { label: "1_2", startVal: -1, startValSd: 0.5, pThreshold: 0.82, nTrials: 2 },
    ],
    method: TrialHandler.Method.FULLRANDOM,
    randomSeed: 42,
    nTrials: 2,
    name: "trials",
    autoLog: false,
  });

describe("addResponse marks the staircase finished when EasyEyes reports the condition done", () => {
  test("isConditionFinished=true sets staircase._finished (stops re-serving at target)", () => {
    const multi = makeMulti();
    const A = multi._staircases.find((s) => s._name === "1_1");
    multi._currentStaircase = A;
    multi.addResponse(1, -1, true, false, false, true); // isConditionFinished
    expect(A.finished).toBe(true);
    // And it is never served again:
    multi._currentPass = [];
    multi.trialKey = ["1_1"];
    multi._nextTrial();
    expect(multi._currentStaircase).not.toBe(A);
  });
});

describe("_nextTrial skips finished staircases in the retry queue", () => {
  test("queued retry for a finished staircase is void; unfinished staircase is served", () => {
    const multi = makeMulti();
    const A = multi._staircases.find((s) => s._name === "1_1");
    const B = multi._staircases.find((s) => s._name === "1_2");

    // Finish A via sequence rollover: counting calls exhaust nTrials=2 and
    // the rollover marks A finished. Re-pin the current staircase before
    // each call — addResponse's _nextTrial advances it otherwise.
    const step = () => {
      multi._currentPass = [];
      multi._currentStaircase = A;
      multi.addResponse(1, -1, true, false, false, false);
    };
    step();
    step();
    step();
    expect(A.finished).toBe(true);

    // A retry for A was queued (as addResponse's doRetryTrial does), and
    // B still has a scheduled entry. A's entry is voided wherever the
    // shuffle puts it; B is served; the loop stays alive.
    multi._currentPass = [];
    multi.trialKey = ["1_1", "1_2"];
    multi._finished = false; // scaffold: isolate queue-selection from setup
    multi._nextTrial();
    expect(multi._currentStaircase).not.toBe(A);
    expect(multi._finished).toBe(false);

    // Every queue position works: force A's entry to be drawn first.
    multi._currentPass = [];
    multi.trialKey = ["1_1", "1_2"];
    multi._finished = false;
    multi._nextTrial();
    expect(multi._currentStaircase).not.toBe(A);
  });

  test("empty retry queue + unfinished staircase terminates the loop (queue-drain)", () => {
    // The pooled retry queue IS the total-trials bound: every served trial
    // consumes one entry (initial conditionTrials + capped retries). When it
    // drains, the loop must finish — even if a staircase never reached its
    // target or rolled over (e.g. an all-bad-timing streak: no counting
    // calls, no rollover). Re-serving the unfinished staircase forever would
    // run trials past maxTrials with no bound.
    const multi = makeMulti();
    const A = multi._staircases.find((s) => s._name === "1_1");
    multi._currentPass = [];
    multi.trialKey = [];
    multi._nextTrial();
    expect(multi._finished).toBe(true);
    expect(multi._currentStaircase).toBeUndefined();
    expect(A.finished).toBe(false); // unfinished, yet the LOOP is done
  });

  test("queued entry for an UNfinished staircase is still served", () => {
    const multi = makeMulti();
    const B = multi._staircases.find((s) => s._name === "1_2");
    multi._currentPass = [];
    multi.trialKey = ["1_2"];
    multi._nextTrial();
    expect(multi._currentStaircase).toBe(B);
    expect(multi._finished).toBe(false);
  });
});
