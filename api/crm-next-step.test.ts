import { describe, it, expect } from "vitest";
import { nextStepFromTimeline } from "./crm-next-step";

describe("nextStepFromTimeline", () => {
  it("без понуда → Направи понуда", () => {
    expect(nextStepFromTimeline({ stage: "new", quote: null, order: null, hasDn: false, hasInvoice: false }).action).toBe("create_quote");
  });
  it("со понуда без нарачка → Отвори понуда", () => {
    const n = nextStepFromTimeline({ stage: "quoted", quote: { id: 5, status: "sent" }, order: null, hasDn: false, hasInvoice: false });
    expect(n.action).toBe("open_quote");
    expect(n.href).toContain("open=5");
  });
  it("со нарачка без испратница → испратници", () => {
    expect(nextStepFromTimeline({ stage: "won", quote: { id: 1, status: "converted" }, order: { id: 2, status: "confirmed" }, hasDn: false, hasInvoice: false }).action).toBe("open_delivery");
  });
  it("изгубена → lost", () => {
    expect(nextStepFromTimeline({ stage: "lost", quote: null, order: null, hasDn: false, hasInvoice: false }).action).toBe("lost");
  });
});
