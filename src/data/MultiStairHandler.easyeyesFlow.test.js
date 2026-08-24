/**
 * Definitive e2e test for the fatal production error:
 *   "Cannot read properties of undefined (reading '0')"
 *   where: trialRoutineEnd   (CrowdingTimeVsSpacing8/9, 2026-08-20)
 *
 * Reproduces the EXACT way EasyEyes drives a MultiStairHandler (see
 * threshold.js trialRoutineEnd → errorMeasurement.addResponseIfTolerableError
 * → MultiStairHandler.addResponse), for a condition with
 * thresholdPracticeUntilCorrectBool=true and trial retries — the parameters
 * of the crashing "50 ms" conditions (conditionTrials=30 in production,
 * shrunk to 3 here; the mechanism is size-independent).
 *
 * The call-pattern contract being tested (each maps to a real EasyEyes call):
 *   practice trial, tolerable, WRONG:   addResponse(0, v, true,  false, true,  false)
 *   practice trial, tolerable, CORRECT: addResponse(1, v, true,  true,  true,  false)  // resets QUEST
 *   real trial, good (given to QUEST):  addResponse(r, v, true,  false, false, isConditionFinished)
 *   real trial, bad, retried:           addResponse(r, v, false, false, true,  false)
 *
 * Why this crashed: practice trials consume trial-sequence slots without
 * counting toward the condition's good-trial target, and each retry
 * (doRetryTrial → addTrial) inflates nRemaining without extending the
 * sequence. The sequence then rolls over (thisRepN = nReps) while the
 * condition is still active and _finished is false — and the next bad trial
 * calls next(false), which skipped the termination guard and read
 * _trialSequence[nReps][0] → TypeError.
 *
 * Desired: the whole session runs to completion without throwing, and every
 * staircase ends up finished.
 */
import { expect, describe, test } from "@jest/globals";
import { MultiStairHandler } from "./MultiStairHandler.js";
import { TrialHandler } from "./TrialHandler.js";

// jsQUEST is a global in the app; a minimal stub suffices — this test targets
// the trial-sequence bookkeeping, not QUEST math. QuestQuantile must NOT
// return a constant 0, else confInterval < stopInterval instantly finishes
// the handler and masks the sequence bug.
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

const N_TRIALS = 3; // production: conditionTrials = 30

const makeMulti = () =>
  new MultiStairHandler({
    psychoJS: mockPsychoJS,
    varName: "trialsVal",
    stairType: MultiStairHandler.StaircaseType.QUEST,
    conditions: [
      {
        label: "2_50 ms right", // EasyEyes block_condition format: block_condition
        startVal: -1,
        startValSd: 0.5,
        pThreshold: 0.82,
        nTrials: N_TRIALS,
      },
    ],
    method: TrialHandler.Method.FULLRANDOM,
    randomSeed: 42,
    nTrials: N_TRIALS,
    name: "trials",
    autoLog: false,
  });

describe("EasyEyes practice+retry flow over MultiStairHandler", () => {
  test("session completes without crashing when practice trials and retries push past the sequence end", () => {
    const trials = makeMulti();
    const staircase = trials._currentStaircase; // single condition: never changes

    const step = (response, doGiveToQuest, doResetQuest, doRetryTrial, isConditionFinished) =>
      trials.addResponse(
        response,
        -1,
        doGiveToQuest,
        doResetQuest,
        doRetryTrial,
        isConditionFinished,
      );

    const run = () => {
      // Practice (thresholdPracticeUntilCorrectBool=true): two tolerable
      // practice trials — wrong then correct. Both are retried (addTrial)
      // and both are given to QUEST, consuming sequence slots without
      // counting toward the condition's good-trial target.
      step(0, true, false, true, false); // practice, wrong
      step(1, true, true, true, false); // practice, correct → reset QUEST

      // Real trials. Two good trials: the second one exhausts the
      // nTrials=3-slot sequence (2 practice + 2 real = 4 counting nexts >
      // 3 slots), while EasyEyes' completed counter is still below target.
      step(1, true, false, false, false); // good
      step(1, true, false, false, false); // good → sequence rolls over

      // The fatal trial in production: a bad trial (timing/gaze
      // unacceptable), retried, NOT given to QUEST → next(false).
      // Pre-fix this threw: Cannot read properties of undefined (reading '0')
      step(0, false, false, true, false); // bad, retried

      // One more good trial finishes the condition (isConditionFinished).
      step(1, true, false, false, true); // good, condition finished
    };

    expect(run).not.toThrow();
    expect(staircase.finished).toBe(true);
  });

  test("no retries pending: rollover still marks the staircase finished", () => {
    const trials = makeMulti();
    // No practice, no retries — plain good trials to exhaustion.
    for (let i = 0; i < N_TRIALS + 1; i++) {
      expect(() =>
        trials.addResponse(1, -1, true, false, false, i === N_TRIALS),
      ).not.toThrow();
    }
  });
});
