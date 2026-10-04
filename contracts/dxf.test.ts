import { describe, it, expect } from "vitest";
import { parseDxf, dxfStats, calcCutting, cutParamsFor, chainPaths } from "./dxf";

const dxf = (header: string, entities: string, blocks = "") => [
  "0", "SECTION", "2", "HEADER", ...header.split("\n").filter(Boolean), "0", "ENDSEC",
  ...(blocks ? ["0", "SECTION", "2", "BLOCKS", ...blocks.split("\n").filter(Boolean), "0", "ENDSEC"] : []),
  "0", "SECTION", "2", "ENTITIES", ...entities.split("\n").filter(Boolean), "0", "ENDSEC", "0", "EOF",
].join("\n");
const lw = (pts: [number, number, number?][], closed = true, layer = "0") =>
  ["0", "LWPOLYLINE", "8", layer, "90", String(pts.length), "70", closed ? "1" : "0", ...pts.flatMap(([x, y, b]) => ["10", String(x), "20", String(y), ...(b ? ["42", String(b)] : [])])].join("\n");
const line = (x1: number, y1: number, x2: number, y2: number) => ["0", "LINE", "8", "0", "10", String(x1), "20", String(y1), "11", String(x2), "21", String(y2)].join("\n");
const circle = (x: number, y: number, r: number) => ["0", "CIRCLE", "8", "0", "10", String(x), "20", String(y), "40", String(r)].join("\n");

describe("DXF", () => {
  it("правоаголник со отвор и контура од поединечни линии", () => {
    const text = dxf("9\n$INSUNITS\n70\n4", [
      lw([[0, 0], [100, 0], [100, 50], [0, 50]]),
      circle(25, 25, 10),
      line(60, 20, 80, 20), line(80, 20, 80, 30), line(80, 30, 60, 30), line(60, 30, 60, 20),
      ["0", "TEXT", "8", "0", "10", "1", "20", "1", "1", "ОЗНАКА"].join("\n"),
    ].join("\n"));
    const r = parseDxf(text);
    expect(r.units).toBe("mm");
    expect(r.skipped.TEXT).toBe(1);
    const s = dxfStats(r.paths);
    expect(s.cutLength).toBeCloseTo(300 + 2 * Math.PI * 10 + 60, 6);
    expect(s.closedContours).toBe(3);
    expect(s.pierces).toBe(3);
    expect(s.netArea).toBeCloseTo(5000 - Math.PI * 100 - 200, -1); // кругот е многуаголник — мала разлика
    expect(s.bbox.width).toBe(100);
    expect(s.bbox.height).toBe(50);
  });

  it("bulge: жлеб (две полукружници) — точна должина", () => {
    // жлеб 40×10: две прави по 30 и две полукружници со r=5
    const r = parseDxf(dxf("", lw([[5, 0, 0], [35, 0, 1], [35, 10, 0], [5, 10, 1]])));
    const s = dxfStats(r.paths);
    expect(s.cutLength).toBeCloseTo(60 + 2 * Math.PI * 5, 6);
    expect(s.bbox.width).toBeCloseTo(40, 1);
    expect(s.netArea).toBeCloseTo(300 + Math.PI * 25, 0);
  });

  it("инчи се претвораат во mm; блок со скалирање и повеќе вметнувања", () => {
    const block = ["0", "BLOCK", "2", "HOLE", "10", "0", "20", "0", circle(0, 0, 1), "0", "ENDBLK"].join("\n");
    const ins = (x: number) => ["0", "INSERT", "8", "0", "2", "HOLE", "10", String(x), "20", "0", "41", "2", "42", "2"].join("\n");
    const r = parseDxf(dxf("9\n$INSUNITS\n70\n1", [ins(0), ins(10)].join("\n"), block));
    expect(r.units).toBe("инчи");
    const s = dxfStats(r.paths);
    expect(s.pierces).toBe(2);
    expect(s.cutLength).toBeCloseTo(2 * (2 * Math.PI * 2 * 25.4), 4);
  });

  it("отворени патеки што не се допираат = посебни пробивања", () => {
    const paths = chainPaths(parseDxf(dxf("", [line(0, 0, 10, 0), line(20, 0, 30, 0)].join("\n"))).paths);
    expect(paths.filter((p) => !p.closed).length).toBe(2);
  });

  it("не-DXF и бинарен DXF се одбиваат со порака", () => {
    expect(() => parseDxf("hello")).toThrow(/не е DXF/);
    expect(() => parseDxf("AutoCAD Binary DXF\r\n\x1a\x00")).toThrow(/Бинарен/);
  });

  it("калкулација: време, тежина, цена", () => {
    const stats = { cutLength: 3000, pierces: 4, closedContours: 4, openPaths: 0, netArea: 100_000, bbox: { minX: 0, minY: 0, maxX: 400, maxY: 250, width: 400, height: 250 } };
    const p = cutParamsFor(3);
    expect(p.speed).toBe(6);
    const c = calcCutting({ stats, quantity: 10, thickness: 3, density: 7.85, speed: 6, pierceSec: 0.5, machinePerHour: 3000, machinePerMeter: 0,
      pricePerKg: 60, materialBasis: "net", margin: 20, edge: 0 });
    // 3 m / 6 m/min = 0.5 min + 4 × 0.5 s = 0.0333 min
    expect(c.minutes).toBeCloseTo(0.53, 2);
    // 10 dm² × 0.03 dm × 7.85 = 2.355 kg
    expect(c.kg).toBeCloseTo(2.355, 3);
    expect(c.material).toBeCloseTo(141.3, 1);
    expect(c.unitPrice).toBeCloseTo(c.unitCost * 1.2, 1);
    expect(cutParamsFor(3.5).speed).toBeCloseTo(5.25, 6);
  });
});
