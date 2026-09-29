import { describe, it, expect } from "vitest";
import { autoSchedule, nextWorkday, isWorkday } from "./schedule";

const machines = [{ id: 1, hoursPerDay: 8, operations: ["cutting_laser"] }, { id: 2, hoursPerDay: 8, operations: ["bending"] }];
const wo = (id: number, priority = "normal") => ({ id, priority, plannedEnd: null, createdAt: `2026-01-0${id}T00:00:00Z` });
const op = (id: number, woId: number, seq: number, operation: string, hours: number) =>
  ({ id, workOrderId: woId, sequence: seq, operation, hours, machineId: null, plannedDate: null, locked: false });

describe("распоред", () => {
  it("викенди не се работни денови", () => {
    expect(isWorkday("2026-10-03")).toBe(false); // сабота
    expect(nextWorkday("2026-10-03")).toBe("2026-10-05");
  });

  it("операцијата оди на машината што ја прави", () => {
    const r = autoSchedule({ from: "2026-10-05", machines, wos: [wo(1)], ops: [op(1, 1, 1, "cutting_laser", 4), op(2, 1, 2, "bending", 2)] });
    expect(r.find(x => x.opId === 1)?.machineId).toBe(1);
    expect(r.find(x => x.opId === 2)?.machineId).toBe(2);
  });

  it("капацитетот се почитува: 3 × 4ч на машина од 8ч = два дена", () => {
    const r = autoSchedule({ from: "2026-10-05", machines, wos: [wo(1), wo(2), wo(3)],
      ops: [op(1, 1, 1, "cutting_laser", 4), op(2, 2, 1, "cutting_laser", 4), op(3, 3, 1, "cutting_laser", 4)] });
    expect(r.map(x => x.plannedDate).sort()).toEqual(["2026-10-05", "2026-10-05", "2026-10-06"]);
  });

  it("итен налог оди прв", () => {
    const r = autoSchedule({ from: "2026-10-05", machines, wos: [wo(1), wo(2, "urgent")],
      ops: [op(1, 1, 1, "cutting_laser", 8), op(2, 2, 1, "cutting_laser", 8)] });
    expect(r.find(x => x.opId === 2)?.plannedDate).toBe("2026-10-05");
    expect(r.find(x => x.opId === 1)?.plannedDate).toBe("2026-10-06");
  });

  it("следната операција не почнува пред претходната", () => {
    const r = autoSchedule({ from: "2026-10-05", machines, wos: [wo(1), wo(2)],
      ops: [op(1, 1, 1, "cutting_laser", 8), op(2, 2, 1, "cutting_laser", 8), op(3, 2, 2, "bending", 1)] });
    expect(r.find(x => x.opId === 3)!.plannedDate >= r.find(x => x.opId === 2)!.plannedDate).toBe(true);
  });

  it("заклучените (веќе закажани) операции не се поместуваат, но го зафаќаат капацитетот", () => {
    const locked = { ...op(9, 9, 1, "cutting_laser", 8), machineId: 1, plannedDate: "2026-10-05", locked: true };
    const r = autoSchedule({ from: "2026-10-05", machines, wos: [wo(1)], ops: [locked, op(1, 1, 1, "cutting_laser", 2)] });
    expect(r).toHaveLength(1);
    expect(r[0].plannedDate).toBe("2026-10-06");
  });

  it("операциите на еден налог во ист ден не надминуваат еден работен ден", () => {
    const r = autoSchedule({ from: "2026-10-05", machines, wos: [wo(1)],
      ops: [op(1, 1, 1, "cutting_laser", 5), op(2, 1, 2, "bending", 3), op(3, 1, 3, "welding_mig", 4)] });
    expect(r.find(x => x.opId === 1)?.plannedDate).toBe("2026-10-05");
    expect(r.find(x => x.opId === 2)?.plannedDate).toBe("2026-10-05"); // 5 + 3 = 8
    expect(r.find(x => x.opId === 3)?.plannedDate).toBe("2026-10-06"); // 8 + 4 > 8
  });
});
