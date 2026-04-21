import { describe, it, expect } from "vitest";
import { pickQuestions, scoreExam } from "@/lib/exam/engine";
import { nextDueDate } from "@/lib/scheduler/recurrence";

describe("pickQuestions", () => {
  it("limits to requested count", () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    expect(pickQuestions(arr, 5).length).toBe(5);
  });
});

describe("scoreExam", () => {
  it("fully correct multi-select = full points", () => {
    const qs: any = [
      {
        id: "q1",
        points: 1,
        options: [
          { id: "a", isCorrect: true },
          { id: "b", isCorrect: true },
          { id: "c", isCorrect: false },
        ],
      },
    ];
    const r = scoreExam(qs, { q1: ["a", "b"] });
    expect(r.score).toBe(100);
  });
  it("partial answer = zero for that question", () => {
    const qs: any = [
      {
        id: "q1",
        points: 1,
        options: [
          { id: "a", isCorrect: true },
          { id: "b", isCorrect: true },
        ],
      },
    ];
    expect(scoreExam(qs, { q1: ["a"] }).score).toBe(0);
  });
});

describe("nextDueDate", () => {
  it("ONE_YEAR adds 1 year + grace days", () => {
    const d = nextDueDate(new Date("2026-01-01"), "ONE_YEAR", 30)!;
    expect(d.getFullYear()).toBe(2027);
  });
  it("NONE returns null", () => {
    expect(nextDueDate(new Date(), "NONE")).toBeNull();
  });
});
