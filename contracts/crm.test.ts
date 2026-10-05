import { describe, it, expect } from "vitest";
import { bucketTasks, stageChange, dealMetrics, addDays, parseTags } from "./crm";

describe("bucketTasks", () => {
  const t = (id: number, dueDate: string | null, doneAt: string | null = null) => ({ id, dueDate, doneAt });
  it("ги дели на доцнат / денес / наскоро / подоцна и ги исклучува завршените", () => {
    const b = bucketTasks([t(1, "2026-10-01"), t(2, "2026-10-05"), t(3, "2026-10-09"), t(4, "2026-11-20"), t(5, null), t(6, "2026-10-01", "2026-10-02")], "2026-10-05");
    expect(b.overdue.map((x) => x.id)).toEqual([1]);
    expect(b.today.map((x) => x.id)).toEqual([2]);
    expect(b.upcoming.map((x) => x.id)).toEqual([3]);
    expect(b.later.map((x) => x.id)).toEqual([4, 5]);
  });
  it("сортира по рок", () => {
    const b = bucketTasks([t(2, "2026-10-03"), t(1, "2026-10-01")], "2026-10-05");
    expect(b.overdue.map((x) => x.id)).toEqual([1, 2]);
  });
});

describe("stageChange", () => {
  it("автоматска веројатност ако не е рачно сменета", () => {
    expect(stageChange("new", "quoted", 10).probability).toBe(60);
  });
  it("ја чува рачната веројатност", () => {
    expect(stageChange("new", "quoted", 35).probability).toBe(35);
  });
  it("добиена/изгубена = затворена; изгубена бара причина", () => {
    expect(stageChange("quoted", "won", 70)).toMatchObject({ probability: 100, closed: true, needsLostReason: false });
    expect(stageChange("quoted", "lost", 70)).toMatchObject({ probability: 0, closed: true, needsLostReason: true });
  });
  it("повторно отворање ја враќа веројатноста по фаза", () => {
    expect(stageChange("lost", "contacted", 0)).toMatchObject({ probability: 25, closed: false });
  });
});

describe("dealMetrics", () => {
  it("win-rate и просечно време до затворање (само добиени)", () => {
    const m = dealMetrics([
      { stage: "won", createdAt: "2026-01-01", closedAt: "2026-01-11", value: 100 },
      { stage: "won", createdAt: "2026-01-01", closedAt: "2026-01-21", value: 50 },
      { stage: "lost", createdAt: "2026-01-01", closedAt: "2026-01-02", value: 999 },
    ]);
    expect(m.won).toBe(2);
    expect(m.lost).toBe(1);
    expect(m.winRate).toBeCloseTo(2 / 3);
    expect(m.wonValue).toBe(150);
    expect(m.avgDaysToClose).toBe(15);
  });
  it("без затворени → null", () => {
    expect(dealMetrics([]).winRate).toBeNull();
    expect(dealMetrics([]).avgDaysToClose).toBeNull();
  });
});

describe("helpers", () => {
  it("addDays преку месец", () => expect(addDays("2026-10-30", 3)).toBe("2026-11-02"));
  it("parseTags: тримирање и без дупликати", () => expect(parseTags(" VIP, ограда;VIP ,, ")).toEqual(["VIP", "ограда"]));
});
