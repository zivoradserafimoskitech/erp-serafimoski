import { describe, it, expect } from "vitest";
import { describeSchedule, parseSchedule, scheduleTotal, advancePercent } from "./payment-terms";
import { isDomesticCountry } from "./country";

describe("услови за плаќање", () => {
  const s = [{ percent: 50, when: "advance" as const }, { percent: 50, when: "after_delivery" as const, days: 15 }];
  it("опис на МК и EN", () => {
    expect(describeSchedule(s, "mk")).toBe("50% авансно (при нарачка), 50% 15 дена по испорака");
    expect(describeSchedule(s, "en")).toBe("50% in advance (with order), 50% 15 days after delivery");
  });
  it("збир и аванс", () => {
    expect(scheduleTotal(s)).toBe(100);
    expect(advancePercent(s)).toBe(50);
  });
  it("стар текст не е распоред", () => {
    expect(parseSchedule("14 дена")).toBeNull();
    expect(parseSchedule(JSON.stringify(s))).toHaveLength(2);
  });
  it("домашна држава", () => {
    expect(isDomesticCountry("")).toBe(true);
    expect(isDomesticCountry("Северна Македонија")).toBe(true);
    expect(isDomesticCountry("North Macedonia")).toBe(true);
    expect(isDomesticCountry("Austria")).toBe(false);
  });
});
