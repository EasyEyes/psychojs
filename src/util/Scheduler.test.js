import { expect, describe, test } from "@jest/globals";
import { Scheduler } from "./Scheduler.js";

// Queue-ordering contract for add() and unshift(). add() appends to the
// back (existing behavior, locked in here as the reference); unshift()
// prepends to the front so a task can be inserted to run NEXT — the
// primitive that makes "restart this block" expressible at the blocks-
// scheduler level (the restarted block is unshifted from endLoopIteration,
// landing between the current block and the next one).
describe("Scheduler task queue ordering", () => {
  test("add appends tasks to the back of the queue", () => {
    const s = new Scheduler({});
    const a = () => {};
    const b = () => {};
    s.add(a);
    s.add(b);
    expect(s._taskList).toEqual([a, b]);
  });

  test("unshift prepends a task to the front of the queue", () => {
    const s = new Scheduler({});
    const a = () => {};
    const b = () => {};
    s.add(a); // [a]
    s.unshift(b); // [b, a]
    expect(s._taskList).toEqual([b, a]);
  });

  test("repeated unshift stacks like Array.unshift (last unshift is frontmost)", () => {
    const s = new Scheduler({});
    const a = () => {};
    const b = () => {};
    const c = () => {};
    s.add(a); // [a]
    s.unshift(b); // [b, a]
    s.unshift(c); // [c, b, a]
    expect(s._taskList).toEqual([c, b, a]);
  });

  test("unshift keeps _argsList in lockstep with _taskList", () => {
    const s = new Scheduler({});
    const a = () => {};
    const b = () => {};
    s.add(a, "a-arg");
    s.unshift(b, "b-arg");
    expect(s._taskList).toEqual([b, a]);
    expect(s._argsList).toEqual([["b-arg"], ["a-arg"]]);
  });

  test("unshift with no args records an empty args array (mirrors add)", () => {
    const s = new Scheduler({});
    const a = () => {};
    s.unshift(a);
    expect(s._argsList).toEqual([[]]);
  });
});
