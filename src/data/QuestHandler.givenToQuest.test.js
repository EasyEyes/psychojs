/**
 * The "given to QUEST" contract (glossary: thresholdAllowedTrialRatio):
 * "Only good trials are passed to QUEST" — a good trial must update the
 * pdf exactly once, with the trial's own (value, response); a bad trial,
 * and the practice flush, must never touch it.
 *
 * Spy stub records every QuestUpdate(value, response) call; the handlers
 * under test are the REAL QuestHandler and MultiStairHandler.
 */
import { expect, describe, test, beforeEach } from "@jest/globals";
import { QuestHandler } from "./QuestHandler.js";
import { MultiStairHandler } from "./MultiStairHandler.js";
import { TrialHandler } from "./TrialHandler.js";

/** QuestUpdate calls: [value, response] pairs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let updates;
const installSpy = () => {
  updates = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.jsQUEST = {
    QuestCreate: () => ({}),
    // jsQUEST signature: QuestUpdate(quest, intensity, response) — record it.
    QuestUpdate: (_q, value, response) => {
      updates.push([value, response]);
      return _q;
    },
    QuestSimulate: () => 1,
    QuestQuantile: (q, p) => (typeof p === "number" ? p : 0),
    QuestMean: () => 0,
    QuestMode: () => 0,
    QuestSd: () => 100,
    QuestBetaAnalysis: () => {},
  };
};

const mockPsychoJS = {
  serverManager: { getResource: () => {} },
  experiment: { addData: () => {} },
  logger: { debug: () => {}, warn: () => {} },
};
globalThis.window = globalThis.window ?? {};

const makeQuest = (nTrials = 4) =>
  new QuestHandler({
    psychoJS: mockPsychoJS,
    varName: "trialsVal",
    startVal: -1,
    startValSd: 1,
    pThreshold: 0.82,
    nTrials,
    name: "s",
  });

describe("QuestHandler passes good trials to QUEST, faithfully", () => {
  beforeEach(installSpy);

  test("a good trial updates the pdf exactly once, with its own value and response", () => {
    const q = makeQuest();
    q.addResponse(1, -0.7, false, true);
    expect(updates).toEqual([[-0.7, 1]]);

    q.addResponse(0, -0.5, false, true);
    expect(updates).toEqual([
      [-0.7, 1],
      [-0.5, 0],
    ]);
  });

  test("a bad trial (doGiveToQuest=false) never touches the pdf", () => {
    const q = makeQuest();
    q.addResponse(1, -0.7, false, false); // bad timing → retry
    expect(updates).toEqual([]);
  });

  test("the practice flush (doResetQuest) never touches the pdf", () => {
    const q = makeQuest();
    q.addResponse(1, -0.7, false, false, true); // first correct → flush
    expect(updates).toEqual([]);
  });

  test("value undefined → updates with the level actually presented (_questValue)", () => {
    const q = makeQuest();
    const presented = q.getQuestValue();
    q.addResponse(1, undefined, false, true);
    expect(updates).toEqual([[presented, 1]]);
  });

  test("array responses (rsvpReading multi-word) update once per element, in order", () => {
    const q = makeQuest();
    q.addResponse([1, 0, 1], -0.7, false, true);
    expect(updates).toEqual([
      [-0.7, 1],
      [-0.7, 0],
      [-0.7, 1],
    ]);
  });
});

describe("MultiStairHandler plumbing carries the give-decision to QUEST", () => {
  beforeEach(installSpy);

  const makeMulti = () =>
    new MultiStairHandler({
      psychoJS: mockPsychoJS,
      varName: "trialsVal",
      stairType: MultiStairHandler.StaircaseType.QUEST,
      conditions: [
        { label: "1_1", startVal: -1, startValSd: 0.5, pThreshold: 0.82, nTrials: 4 },
      ],
      method: TrialHandler.Method.FULLRANDOM,
      randomSeed: 42,
      nTrials: 4,
      name: "trials",
      autoLog: false,
    });

  test("isTrialGood=true → exactly one pdf update with the trial's level", () => {
    const multi = makeMulti();
    updates.length = 0; // constructor's initial estimate doesn't update
    multi.addResponse(1, -0.7, true, false, false, false);
    expect(updates).toEqual([[-0.7, 1]]);
  });

  test("isTrialGood=false (bad timing) → zero pdf updates", () => {
    const multi = makeMulti();
    updates.length = 0;
    multi.addResponse(1, -0.7, false, false, false, false);
    expect(updates).toEqual([]);
  });

  test("practice flush through the plumbing → zero pdf updates", () => {
    const multi = makeMulti();
    updates.length = 0;
    multi.addResponse(1, -0.7, false, true, false, false);
    expect(updates).toEqual([]);
  });
});
