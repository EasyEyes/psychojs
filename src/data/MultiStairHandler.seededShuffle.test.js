/**
 * RED: the FULL_RANDOM retry-queue shuffle must use the handler's seeded
 * random generator. `util.shuffle(this.trialKey)` without the generator
 * draws from Math.random, so two identically-seeded handlers (or two runs
 * of the same seeded experiment) interleave conditions differently —
 * same-seed runs must be reproducible for differential testing.
 *
 * Desired: two handlers constructed identically (same randomSeed, same
 * queue state) serve the same staircase sequence across successive
 * _nextTrial rebuilds.
 */
import { expect, describe, test } from "@jest/globals";
import { MultiStairHandler } from "./MultiStairHandler.js";
import { TrialHandler } from "./TrialHandler.js";

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
      { label: "1_1", startVal: -1, startValSd: 0.5, pThreshold: 0.82, nTrials: 3 },
      { label: "1_2", startVal: -1, startValSd: 0.5, pThreshold: 0.82, nTrials: 3 },
      { label: "1_3", startVal: -1, startValSd: 0.5, pThreshold: 0.82, nTrials: 3 },
    ],
    method: TrialHandler.Method.FULLRANDOM,
    randomSeed: 42,
    nTrials: 3,
    name: "trials",
    autoLog: false,
  });

/** Sequence of staircases served across successive pass rebuilds. */
const servedSequence = (multi, rebuilds) => {
  const seq = [];
  for (let i = 0; i < rebuilds; i++) {
    multi._currentPass = [];
    multi.trialKey = ["1_1", "1_2", "1_3"];
    multi._nextTrial();
    seq.push(multi._currentStaircase?._name ?? null);
  }
  return seq;
};

describe("FULL_RANDOM retry-queue shuffle is seeded", () => {
  test("identically-seeded handlers serve identical staircase sequences", () => {
    const a = makeMulti();
    const b = makeMulti();
    const seqA = servedSequence(a, 6);
    const seqB = servedSequence(b, 6);
    expect(seqA.every((name) => name !== null)).toBe(true);
    expect(seqA).toEqual(seqB);
  });
});
