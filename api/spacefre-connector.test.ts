import { describe, expect, it } from "vitest";
import { normalizeCurrency, orderFromCard, signSpacefre, verifySpacefre, ORDER_STATUS_FROM_SPACEFRE } from "./spacefre-connector";

describe("spacefre signature", () => {
  it("accepts a fresh, untampered body and rejects the rest", () => {
    const h = signSpacefre("whsec_x", '{"a":1}', 1_700_000_000);
    expect(verifySpacefre("whsec_x", '{"a":1}', h, 1_700_000_010)).toBe(true);
    expect(verifySpacefre("whsec_x", '{"a":2}', h, 1_700_000_010)).toBe(false);
    expect(verifySpacefre("whsec_y", '{"a":1}', h, 1_700_000_010)).toBe(false);
    expect(verifySpacefre("whsec_x", '{"a":1}', h, 1_700_009_999)).toBe(false);
  });
  it("matches the Spacefre reference vector", () => {
    // same inputs as tests/integration/test_factory_connector.py::test_signature_rejects_tampering
    expect(signSpacefre("whsec_x", '{"a":1}', 1_700_000_000)).toBe("t=1700000000,v1=b3438763ab46d9634b9844c8722818eaf523f803db1327484c6067462a5fd6d1");
  });
});

describe("mapping", () => {
  it("builds an ERP order from a factory-safe card", () => {
    const o = orderFromCard({
      work_order_id: "wo-1", reference: "WO-23715495", status: "issued", process: "laser_cut",
      material: "S235JR", thickness_mm: "3", dimensions_mm: ["200", "120", "3"], quantity: 100,
      due_date: "2026-10-20", ship_date: null, payout_eur: "250.00",
    });
    expect(o.orderNumber).toBe("SF-WO-23715495");
    expect(o.status).toBe("pending");
    expect(o.item.unitPrice).toBe("2.50");
    expect(o.item.dimensions).toBe("200 × 120 × 3");
  });
  it("covers every Spacefre status", () => {
    for (const s of ["issued", "acknowledged", "in_progress", "completed", "inspected", "released_to_next_op", "rejected"]) {
      expect(ORDER_STATUS_FROM_SPACEFRE[s]).toBeTruthy();
    }
  });
});

describe("currency", () => {
  it("maps ERP labels to ISO codes", () => {
    expect(normalizeCurrency("ден")).toBe("MKD");
    expect(normalizeCurrency("MKD")).toBe("MKD");
    expect(normalizeCurrency("€")).toBe("EUR");
    expect(normalizeCurrency("eur")).toBe("EUR");
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency("", "EUR")).toBe("EUR");
    expect(() => normalizeCurrency("denarчиња")).toThrow();
  });
});
