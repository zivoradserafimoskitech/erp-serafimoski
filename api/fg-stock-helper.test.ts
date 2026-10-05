import { describe, it, expect } from "vitest";
import { remainingToDeliver, availableFg, allocateDelivery, returnableQty } from "./fg-stock-helper";

describe("fg-stock-helper (чиста логика)", () => {
  it("remainingToDeliver не оди под нула", () => {
    expect(remainingToDeliver(10, 0)).toBe(10);
    expect(remainingToDeliver(10, 4)).toBe(6);
    expect(remainingToDeliver(10, 10)).toBe(0);
    expect(remainingToDeliver(10, 12)).toBe(0);
  });

  it("availableFg = физичка − резервирано", () => {
    expect(availableFg(100, 40)).toBe(60);
    expect(availableFg(10, 15)).toBe(-5);
  });

  it("allocateDelivery — делумна испорака и backorder", () => {
    expect(allocateDelivery(10, 10)).toEqual({ ship: 10, backorder: 0 });
    expect(allocateDelivery(10, 4)).toEqual({ ship: 4, backorder: 6 });
    expect(allocateDelivery(3, 10)).toEqual({ ship: 3, backorder: 0 });
    expect(allocateDelivery(0, 5)).toEqual({ ship: 0, backorder: 0 });
  });

  it("returnableQty = delivered − alreadyReturned", () => {
    expect(returnableQty(10, 0)).toBe(10);
    expect(returnableQty(10, 3)).toBe(7);
    expect(returnableQty(10, 10)).toBe(0);
    expect(returnableQty(5, 8)).toBe(0);
  });
});
