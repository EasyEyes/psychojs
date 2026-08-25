/**
 * Block-scheduling model tests: drive the REAL MultiStairHandler /
 * QuestHandler / TrialHandler state machines the way threshold.js does,
 * and assert the scheduling contract (targets, budgets, practice phases).
 *
 * The driver mirrors threshold.js's trials loop faithfully:
 *  - LoopBegin schedules eagerly: `for (const _trial of trials) { snapshot =
 *    trials.getSnapshot(); ...add(tasks) }` (threshold.js ~3563) — the outer
 *    iterator is fully consumed before any trial runs.
 *  - trialInstructionRoutineBegin calls TrialHandler.fromSnapshot(snapshot)
 *    (threshold.js ~5267) — this rewinds the handler's counters per trial
 *    (and, via the never-written `snapshot._finished` key, resets
 *    `_finished` to undefined, which un-gates MultiStairHandler.addResponse).
 *  - importConditions → incrementTrialsAttempted (threshold.js ~10363).
 *  - trialRoutineEnd flag computation (threshold.js ~9886-9921):
 *      justPracticing = thresholdPracticeUntilCorrectBool && !doneWithPractice
 *      flush          = justPracticing && correct
 *      retry          = (justPracticing || prevRetry) && okToRetryThisTrial
 *  - letter: addResponseIfTolerableError (components/errorMeasurement.js):
 *      valid = timing checks; retry ||= (!valid || justPracticing) && okToRetry
 *    sound/vocoderPhrase/movie/vernier switch cases pass isTrialGood = true
 *    (hardcoded TODO) and retry = justPracticing && okToRetry.
 *  - isConditionFinished pre-increment, with nthTrialByCondition's
 *    DefaultMap(() => 1) semantics (components/status.ts, retryTrials.ts).
 *  - after addResponse: `if (!retryThisTrialBool) incrementTrialsCompleted`
 *    (threshold.js ~10211), reset retryThisTrialBool.
 *  - endLoopIteration stops on snapshot.finished (threshold.js ~10288).
 *
 * Out of model scope (not exercised): the skipped-trial path, QA conditions,
 * takeABreak, recalibration restarts, reading (plain TrialHandler) blocks.
 *
 * FINDINGS documented here (all spec-checked against the glossary):
 *  F1  RESOLVED — NOT A BUG (spec behavior). Glossary
 *      (thresholdPracticeUntilCorrectBool): "The (wrong) trials are
 *      collected in the normal way, so Quest keeps making the task easier.
 *      Practice trials count towards the number of trials you request
 *      through conditionTrials." So a never-correct participant's
 *      condition legitimately ends after ~conditionTrials trials; the
 *      flush refunds the budget only after the first correct. (Also
 *      glossary: "bad" = disallowed blackout/duration/lateness/gaze/
 *      response-delay — i.e. OUR fault — and only good trials are passed
 *      to QUEST; wrong answers on test trials count normally and are never
 *      retried.) An earlier revision of this file asserted the opposite;
 *      corrected.
 *  F2  Letter-block sizing is ceil(Σ conditionTrials×ratio) (sum-then-
 *      ceil) but the per-condition spec bound is ceil/round per condition —
 *      fractional ratio parts that sum across conditions steal scheduled
 *      iterations from whichever condition draws last (early end, budget
 *      unspent).
 *  FS  sound blocks are sized at totalTrialsThisBlock (NO retry headroom;
 *      letter/repeatedLetters/rsvpReading/vocoderPhrase/movie/vernier all
 *      size at maxTrials): bad-trial retries (spec: up to ratio×trials
 *      attempts) cannot be honored, and the practice flush cannot refund
 *      its scheduled iteration — every practice trial permanently
 *      displaces an on-record trial. With practice on (the default), the
 *      flush trial itself is always one such displacement.
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
globalThis.window = globalThis.window ?? {};

/** Mirrors the trials loop for one QUEST MultiStair block.
 * @param {object} opts
 * @param {Array<{label:string,target:number,ratio:number}>} opts.conditions
 * @param {number} opts.sizing outer nTrials: threshold.js letter path uses
 *   ceil(Σ target×ratio) (maxTrials); sound/vocoderPhrase/movie/vernier use
 *   Σ target (totalTrialsThisBlock, NO retry headroom).
 * @param {(i:number)=>{correct:boolean,timingGood:boolean}} opts.script per-
 *   iteration participant behavior (indexed by scheduled iteration).
 * @param {boolean} [opts.practice=true] thresholdPracticeUntilCorrectBool.
 * @param {"letter"|"sound"} [opts.mode="letter"] letter runs timing checks;
 *   sound hardcodes isTrialGood=true.
 * @param {number} [opts.seed]
 */
function runTrialsLoop({ conditions, sizing, script, practice = true, mode = "letter", seed = 42 }) {
  const multi = new MultiStairHandler({
    psychoJS: mockPsychoJS,
    varName: "trialsVal",
    stairType: MultiStairHandler.StaircaseType.QUEST,
    conditions: conditions.map((c) => ({
      label: c.label, startVal: -1, startValSd: 0.5, pThreshold: 0.82, nTrials: c.target,
    })),
    method: TrialHandler.Method.FULLRANDOM,
    randomSeed: seed,
    nTrials: sizing,
    name: "trials",
    autoLog: false,
  });

  // === trialsLoopBegin: eager scheduling (threshold.js ~3563) ===
  const snapshots = [];
  for (const _trial of multi) snapshots.push(multi.getSnapshot());

  // Per-condition counters, mirroring components/status.ts DefaultMaps.
  const attempted = new Map(); // DefaultMap(() => 0)
  const completedRaw = new Map(); // actual completed count
  const completedOf = (bc) => (completedRaw.has(bc) ? completedRaw.get(bc) : 0) + 1; // DefaultMap(() => 1) read
  const doneWithPractice = new Map();

  const served = [];
  let retryThisTrialBool = false; // status.retryThisTrialBool

  for (let k = 0; k < snapshots.length; k++) {
    // trialInstructionRoutineBegin (threshold.js ~5267)
    TrialHandler.fromSnapshot(snapshots[k]);
    const stair = multi._currentStaircase;
    if (!stair) break; // loop already finished (queue drained earlier)
    const BC = stair._name;

    // importConditions → incrementTrialsAttempted (threshold.js ~10363)
    attempted.set(BC, (attempted.get(BC) ?? 0) + 1);

    const { correct, timingGood } = script(k);
    const cond = conditions.find((c) => c.label === BC);

    // trialRoutineEnd flag computation (threshold.js ~9886-9921)
    const justPracticing = practice && !doneWithPractice.get(BC);
    const flush = justPracticing && correct;
    if (flush) doneWithPractice.set(BC, true);

    // okayToRetryThisTrial (components/retryTrials.ts)
    const trialsMax = Math.ceil(cond.target * cond.ratio);
    const retriesAlreadyDone = Math.max(0, attempted.get(BC) - completedOf(BC));
    const okToRetry = retriesAlreadyDone < trialsMax - cond.target;

    const valid = mode === "letter" ? timingGood : true; // sound: isTrialGood=true hardcoded
    // outer: retry = (justPracticing || prev) && okToRetry;
    // letter inner: retry ||= (!valid || justPracticing) && okToRetry;
    retryThisTrialBool =
      mode === "letter"
        ? okToRetry && (justPracticing || !valid)
        : okToRetry && justPracticing;

    // isConditionFinished (components/retryTrials.ts): pre-increment check
    const isCondFin = cond.target > 0 && valid && completedOf(BC) >= cond.target;

    served.push({
      BC,
      kind: (valid ? "good" : "bad") + (justPracticing ? "practice" : "test"),
      servedFinishedStaircase: stair.finished,
      flush,
    });

    multi.addResponse(correct ? 1 : 0, -1, valid, flush, retryThisTrialBool, isCondFin);

    if (!retryThisTrialBool) completedRaw.set(BC, (completedRaw.get(BC) ?? 0) + 1);
    retryThisTrialBool = false;

    if (snapshots[k].finished) break; // endLoopIteration → scheduler.stop()
  }
  return { served, multi };
}

const letterSizing = (conds) =>
  Math.ceil(conds.reduce((a, c) => a + c.target * c.ratio, 0));
const soundSizing = (conds) => conds.reduce((a, c) => a + c.target, 0);

const countKinds = (served, bc) => ({
  goodTest: served.filter((s) => s.BC === bc && s.kind === "goodtest").length,
  attempts: served.filter((s) => s.BC === bc).length,
});

// ---------------------------------------------------------------------------
// FS: sound-path sizing has no retry headroom
// ---------------------------------------------------------------------------
describe("FS: block sizing vs practice retries", () => {
  // One condition, target 3, ratio 1.5 (2 retries allowed). Participant:
  // one WRONG trial, then always correct. Practice-until-correct (default
  // TRUE) retries the wrong trial and the correct-practice trial.
  const conds = [{ label: "1_1", target: 3, ratio: 1.5 }];
  const script = (i) => ({ correct: i > 0, timingGood: true });

  test("letter sizing (maxTrials): practice retries do not shorten the block", () => {
    const { served } = runTrialsLoop({ conditions: conds, sizing: letterSizing(conds), script });
    const { goodTest } = countKinds(served, "1_1");
    expect(goodTest).toBe(3);
  });

  test.failing("FS: sound sizing (totalTrialsThisBlock): practice retries must not shorten the block", () => {
    const { served } = runTrialsLoop({ conditions: conds, sizing: soundSizing(conds), script, mode: "sound" });
    const { goodTest } = countKinds(served, "1_1");
    expect(goodTest).toBe(3);
  });

  test("FS characterization: sound block currently ends 1 test trial short per wrong practice trial", () => {
    const { served } = runTrialsLoop({ conditions: conds, sizing: soundSizing(conds), script, mode: "sound" });
    const { goodTest, attempts } = countKinds(served, "1_1");
    // 1 wrong practice + 1 correct practice (both retried) + 1 test = 3
    // iterations (sizing); only 1 of the 3 requested test trials is served.
    expect(goodTest).toBe(1);
    expect(attempts).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// F1 resolved as SPEC: practice trials count towards conditionTrials
// ---------------------------------------------------------------------------
describe("F1 (spec): practice trials with good timing count towards conditionTrials", () => {
  const conds = [{ label: "1_1", target: 3, ratio: 4 }]; // trialsMax = 12

  test("never-correct participant (good timing): condition ends after ~conditionTrials trials, gracefully", () => {
    // Glossary thresholdPracticeUntilCorrectBool: "The (wrong) trials are
    // collected in the normal way, so Quest keeps making the task easier.
    // Practice trials count towards the number of trials you request
    // through conditionTrials." The retry budget (trialsMax) bounds only
    // retries of BAD trials. Bound here: 3 counting calls + the rollover
    // serve (the pre-f9f8921 crash site) = 4 attempts, then the condition
    // ends with zero test trials — by design.
    const { served } = runTrialsLoop({
      conditions: conds, sizing: letterSizing(conds),
      script: () => ({ correct: false, timingGood: true }),
    });
    const { attempts, goodTest } = countKinds(served, "1_1");
    expect(attempts).toBe(4); // target + rollover serve
    expect(goodTest).toBe(0);
  });

  test("never-correct participant with BAD timing gets the full budget (bad = EasyEyes' fault, retried)", () => {
    // Distinct fault classes, distinct accounting — glossary:
    // thresholdAllowedTrialRatio bounds "good and bad" trial totals; a
    // bad-timing trial is NOT passed to QUEST and does not count.
    const { served } = runTrialsLoop({
      conditions: conds, sizing: letterSizing(conds),
      script: () => ({ correct: false, timingGood: false }),
    });
    const { attempts } = countKinds(served, "1_1");
    expect(attempts).toBe(12);
  });

  test("wrong answers on TEST trials count normally and are not retried", () => {
    // "bad" (EasyEyes' presentation fault) vs "wrong" (participant's
    // answer) are independent axes; only the former is retried.
    const conds2 = [{ label: "1_1", target: 3, ratio: 1 }];
    const answers = [false, false, false]; // every test trial wrong
    const { served } = runTrialsLoop({
      conditions: conds2, sizing: letterSizing(conds2), practice: false,
      script: (i) => ({ correct: answers[i] ?? false, timingGood: true }),
    });
    expect(served).toHaveLength(3);
    expect(served.every((s) => s.kind === "goodtest")).toBe(true); // given to QUEST, no retries
  });
});

// ---------------------------------------------------------------------------
// F2: sum-then-ceil sizing steals iterations when fractional ratios sum
// ---------------------------------------------------------------------------
describe("F2: per-condition retry budgets vs pooled sizing", () => {
  const conds = [
    { label: "1_1", target: 1, ratio: 1.5 },
    { label: "1_2", target: 1, ratio: 1.5 },
  ];
  // Both participants answer correctly with good timing after one bad-timing
  // first trial: each condition needs target + 1 attempts (≤ trialsMax 2).
  const script = (i) => ({ correct: true, timingGood: i > 0 ? true : i === 0 ? false : true });

  test.failing("F2: Σ ceil(target×ratio) sizing: every condition reaches target or spends its budget", () => {
    const sizing = conds.reduce((a, c) => a + Math.ceil(c.target * c.ratio), 0); // 4
    const { served } = runTrialsLoop({ conditions: conds, sizing, script });
    for (const bc of ["1_1", "1_2"]) {
      const { goodTest, attempts } = countKinds(served, bc);
      expect(goodTest === 1 || attempts === 2).toBe(true);
    }
  });

  test("F2 characterization: current ceil(Σ) sizing (3) drops the condition drawn last", () => {
    const { served } = runTrialsLoop({ conditions: conds, sizing: letterSizing(conds), script });
    const got = ["1_1", "1_2"].map((bc) => {
      const { goodTest, attempts } = countKinds(served, bc);
      return { bc, goodTest, attempts };
    });
    // One condition ends with its bad trial retried-unreplayed: 1 attempt,
    // 0 good, budget unspent (1 of 2 allowed attempts unused).
    expect(got.some((g) => g.goodTest === 1)).toBe(true);
    expect(got.some((g) => g.attempts === 1 && g.goodTest === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// V3: bad trials whose retry is DENIED (budget out) count toward completion
// ---------------------------------------------------------------------------
// Glossary (thresholdAllowedTrialRatio): EasyEyes keeps running "until either
// 1. the number of GOOD trials reaches conditionTrials, or 2. [maxTrials]".
// A bad trial is not good, so it must not advance the completion check —
// but threshold.js's trialRoutineEnd increments nthTrialByCondition whenever
// the trial is not retried, including bad-denied trials.
// Scheduling-level note: in single-condition blocks the false finish is
// structurally coincident with clause-2 exhaustion (the denied bads that
// inflate the counter also consume the budget — traced: spec-counting
// delivers the same 2 good trials here), so the scheduling harm is pinned
// by the PBT early-end invariant, not a focused script. The counter-purity
// bug itself (completion counter / visible counter / %correct denominator
// counting denied-bads) is pinned against the REAL retryTrials code in
// tests/retryTrials.goodCounter.test.ts.

describe("V3: bad-denied trials must not count toward the good-trial target", () => {
  // target 4, ratio 1.5 → trialsMax 6, retriesAllowed 2.
  // Script: good, good, bad (retried), bad (retried), bad (DENIED — budget
  // out), good. Under the spec, completion counts good trials only, so the
  // condition may NOT finish on the DENIED-bad trial (good so far: 2 < 4).
  const conds = [{ label: "1_1", target: 4, ratio: 1.5 }];
  const script = [
    { correct: true, timingGood: true }, // good #1
    { correct: true, timingGood: true }, // good #2
    { correct: true, timingGood: false }, // bad → retry (1/2)
    { correct: true, timingGood: false }, // bad → retry (2/2)
    { correct: true, timingGood: false }, // bad → DENIED
    { correct: true, timingGood: true }, // good #3
  ];

  test("V3 characterization: denied-bad trials currently count toward the target (good=2, spec allows 3)", () => {
    const { served } = runTrialsLoop({
      conditions: conds, sizing: letterSizing(conds),
      script: (i) => script[i] ?? { correct: true, timingGood: true },
    });
    const { goodTest, attempts } = countKinds(served, "1_1");
    // The two denied bads inflate nthTrialByCondition (DefaultMap default 1
    // + good + denieds = 4 = target), so the last good trial fires
    // isConditionFinished early: 2 good delivered where spec allows 3.
    expect(goodTest).toBe(2);
    expect(attempts).toBe(6); // budget fully consumed either way
  });
});

// ---------------------------------------------------------------------------
// Property-based net over the REAL handlers
// ---------------------------------------------------------------------------
describe("property-based scheduling invariants (letter path, real handlers)", () => {
  const mulberry32 = (seed) => {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const N_RUNS = 200;

  const runProperty = (rng, { ratios, practice, seed, allowPracticeBoundedEarlyEnd = false }) => {
    const nConds = 1 + Math.floor(rng() * 3);
    const conditions = Array.from({ length: nConds }, (_, i) => ({
      label: `1_${i + 1}`,
      target: 1 + Math.floor(rng() * 5),
      ratio: ratios[Math.floor(rng() * ratios.length)],
    }));
    const pCorrect = [0.2, 0.5, 0.8][Math.floor(rng() * 3)];
    const pGoodTiming = [0.3, 0.7, 0.95][Math.floor(rng() * 3)];
    const sizing = letterSizing(conditions);

    const { served } = runTrialsLoop({
      conditions, sizing, practice, seed,
      script: () => ({ correct: rng() < pCorrect, timingGood: rng() < pGoodTiming }),
    });

    const violations = [];
    for (const c of conditions) {
      const mine = served.filter((s) => s.BC === c.label);
      const { goodTest, attempts } = countKinds(served, c.label);
      const trialsMax = Math.ceil(c.target * c.ratio);
      if (attempts > trialsMax)
        violations.push(`${c.label}: attempts ${attempts} > trialsMax ${trialsMax}`);
      if (goodTest > c.target)
        violations.push(`${c.label}: goodTest ${goodTest} > target ${c.target}`);
      if (!allowPracticeBoundedEarlyEnd && goodTest < c.target && attempts < trialsMax)
        violations.push(`${c.label}: goodTest ${goodTest} < target ${c.target} with ${attempts}<${trialsMax} attempts (early end)`);
      const firstTest = mine.findIndex((s) => s.kind.endsWith("test"));
      const lastPractice = mine.reduce((acc, s, i) => (s.kind.endsWith("practice") ? i : acc), -1);
      if (firstTest !== -1 && lastPractice > firstTest)
        violations.push(`${c.label}: practice row after test rows`);
      for (const s of mine)
        if (s.servedFinishedStaircase)
          violations.push(`${c.label}: served a finished staircase (spurious)`);
    }
    return violations;
  };

  test("practice OFF, integral ratios: all invariants hold", () => {
    for (let run = 0; run < N_RUNS; run++) {
      const violations = runProperty(mulberry32(1000 + run), { ratios: [1, 2, 4], practice: false, seed: 1000 + run });
      expect(violations).toEqual([]);
    }
  });

  test.failing("F2: practice OFF, fractional ratios: early ends from sum-then-ceil sizing", () => {
    for (let run = 0; run < N_RUNS; run++) {
      const violations = runProperty(mulberry32(1000 + run), { ratios: [1, 1.5, 2, 4], practice: false, seed: 1000 + run });
      expect(violations).toEqual([]);
    }
  });

  test("practice ON (spec): budgets, targets, practice prefix, no spurious serves", () => {
    // Practice-counting early ends are SPEC (F1 resolved) — no early-end
    // assertion here; that invariant is checked practice-off only (F2).
    for (let run = 0; run < N_RUNS; run++) {
      const violations = runProperty(mulberry32(1000 + run), { ratios: [1, 1.5, 2, 4], practice: true, seed: 1000 + run, allowPracticeBoundedEarlyEnd: true });
      expect(violations).toEqual([]);
    }
  });

  test("all-bad timing streaks terminate at the retry budget (queue-drain bound)", () => {
    const conditions = [{ label: "1_1", target: 3, ratio: 2 }];
    const { served } = runTrialsLoop({
      conditions,
      sizing: letterSizing(conditions),
      script: () => ({ correct: true, timingGood: false }),
    });
    const { attempts } = countKinds(served, "1_1");
    expect(attempts).toBe(6); // ceil(3*2): budget bound, not target
    expect(served.length).toBe(6);
  });
});
