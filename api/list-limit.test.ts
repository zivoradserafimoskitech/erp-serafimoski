import { describe, it, expect } from "vitest";
import { listLimit, DEFAULT_LIST_LIMIT } from "./list-limit";

describe("граница на листи", () => {
  it("без филтер — најнови 500", () => {
    expect(listLimit(undefined)).toBe(DEFAULT_LIST_LIMIT);
    expect(listLimit({ search: undefined, status: "" })).toBe(DEFAULT_LIST_LIMIT);
  });
  it("со пребарување или филтер — сите записи", () => {
    expect(listLimit({ search: "ПО-001" })).toBeGreaterThan(100000);
    expect(listLimit({ customerId: 5 })).toBeGreaterThan(100000);
  });
  it("бараниот limit се почитува", () => {
    expect(listLimit({ limit: 50 })).toBe(50);
  });
});
