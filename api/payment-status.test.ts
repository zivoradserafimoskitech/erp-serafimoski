import { describe, it, expect } from "vitest";
import { paymentStatus } from "./payment-status";

describe("paymentStatus", () => {
  it("платена / делумно / отворена", () => {
    expect(paymentStatus("issued", 100, 100, "invoice")).toBe("paid");
    expect(paymentStatus("sent", 40, 100, "invoice")).toBe("partial");
    expect(paymentStatus("overdue", 0, 100, "invoice")).toBe("overdue");
  });
  it("бришење на уплата ја враќа фактурата на отворена", () => {
    expect(paymentStatus("paid", 0, 100, "invoice")).toBe("issued");
    expect(paymentStatus("partial", 0, 100, "incoming_invoice")).toBe("received");
  });
  it("нацрт и откажана не се менуваат", () => {
    expect(paymentStatus("draft", 100, 100, "invoice")).toBe("draft");
    expect(paymentStatus("cancelled", 100, 100, "invoice")).toBe("cancelled");
  });
});
