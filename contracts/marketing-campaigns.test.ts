import { describe, it, expect } from "vitest";
import { addUtm, renderCampaign, parseCsv, csvContacts, slugify, segmentWhere, segmentRulesSchema, blockSchema, type Block } from "./marketing-campaigns";

const own = ["serafimoski.tech"];
const utm = { source: "newsletter", medium: "email", campaign: "esen-2026" };

describe("addUtm", () => {
  it("само на сопствен домен; hash рутирање; постоечки utm не се менува", () => {
    expect(addUtm("https://serafimoski.tech/#/ograda", utm, own)).toBe("https://serafimoski.tech/?utm_source=newsletter&utm_medium=email&utm_campaign=esen-2026#/ograda");
    expect(addUtm("https://www.serafimoski.tech/x?a=1", { ...utm, content: "button1" }, own)).toContain("a=1&utm_source=newsletter&utm_medium=email&utm_campaign=esen-2026&utm_content=button1");
    expect(addUtm("https://serafimoski.tech/?utm_source=fb", utm, own)).toContain("utm_source=fb");
    expect(addUtm("https://google.com/maps", utm, own)).toBe("https://google.com/maps");
    expect(addUtm("mailto:a@b.mk", utm, own)).toBe("mailto:a@b.mk");
    expect(addUtm("not a url", utm, own)).toBe("not a url");
  });
  it("slugify (кирилица → латиница)", () => {
    expect(slugify("Есенска акција — Огради 2026!")).toBe("esenska-akcija-ogradi-2026");
    expect(slugify("Ѓорѓи Љубљана Џез")).toBe("gjorgji-ljubljana-djez");
    expect(slugify("!!!")).toBe("kampanja");
  });
});

describe("renderCampaign", () => {
  const blocks: Block[] = [
    { type: "heading", text: "Здраво {{first_name}}" },
    { type: "text", text: "Нова **акција** до петок.\n\nПовеќе на https://serafimoski.tech/#/akcija <script>" },
    { type: "button", label: "Побарај понуда", url: "https://serafimoski.tech/#/kontakt" },
    { type: "product", productId: 7, showPrice: true },
    { type: "product", productId: 99, showPrice: true },
    { type: "offer", title: "Ограда -15%", text: "", price: "1.990 ден.", oldPrice: "2.340 ден.", url: "https://serafimoski.tech/#/ograda" },
    { type: "divider" },
  ];
  const linked: string[] = [];
  const out = renderCampaign({
    subject: "{{first_name}}, акција", preheader: "Само оваа недела", blocks,
    products: { 7: { id: 7, name: "Ограда <Модел А>", description: "Поцинкувана", imageUrl: "https://serafimoski.tech/a.jpg", webUrl: "https://serafimoski.tech/#/a", price: 2500, priceNote: "ваша цена, без ДДВ" } },
    vars: { first_name: "Марко", name: "Марко Петровски" },
    link: (u, c) => { linked.push(`${c}:${u}`); return `https://erp/c?u=${encodeURIComponent(u)}`; },
    unsubscribeUrl: "https://erp/api/m/u/TOK", openPixelUrl: "https://erp/api/m/o/TOK.gif",
    company: { name: "Серафимоски", address: "Скопје" },
  });
  it("персонализација, бегство, линкови преку следење", () => {
    expect(out.subject).toBe("Марко, акција");
    expect(out.html).toContain("Здраво Марко");
    expect(out.html).toContain("<strong>акција</strong>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("Ограда &lt;Модел А&gt;");
    expect(out.html).toContain("2.500 ден.");
    expect(out.html).toContain("ваша цена, без ДДВ");
    expect(out.html).toContain("Само оваа недела");
    expect(out.html).toContain('href="https://erp/api/m/u/TOK"');
    expect(out.html).toContain('src="https://erp/api/m/o/TOK.gif"');
    expect(out.html).toContain("<s style=\"color:#888\">2.340 ден.</s>");
    expect(linked).toEqual(expect.arrayContaining(["text2:https://serafimoski.tech/#/akcija", "button3:https://serafimoski.tech/#/kontakt", "product7:https://serafimoski.tech/#/a", "offer6:https://serafimoski.tech/#/ograda"]));
    expect(out.html).not.toContain("productId");
  });
  it("текст верзија со одјава", () => {
    expect(out.text).toContain("ЗДРАВО МАРКО");
    expect(out.text).toContain("Одјава: https://erp/api/m/u/TOK");
    expect(out.text).toContain("Ограда <Модел А> — 2.500 ден.");
  });
  it("валидација на блок", () => {
    expect(blockSchema.safeParse({ type: "button", label: "x", url: "https://a" }).success).toBe(true);
    expect(blockSchema.safeParse({ type: "video", url: "x" }).success).toBe(false);
  });
});

describe("CSV увоз", () => {
  it("точка-запирка, BOM, наводници, кирилични заглавја", () => {
    const rows = parseCsv('\uFEFFЕ-пошта;Име;Фирма;Град\r\n"marko@firma.mk";"Петровски; Марко";"Фирма ""А"" ДОО";Скопје\r\n');
    expect(rows).toEqual([["Е-пошта", "Име", "Фирма", "Град"], ["marko@firma.mk", "Петровски; Марко", 'Фирма "А" ДОО', "Скопје"]]);
  });
  it("валидација, дупликати, согласност по ред, без заглавје", () => {
    const r = csvContacts("email,name,consent\nA@B.mk,Ана,да\nlose-adresa,Иван,\na@b.mk,Дупликат,\nc@d.mk,Ц,не\n");
    expect(r.contacts).toEqual([{ email: "a@b.mk", name: "Ана", consent: true }, { email: "c@d.mk", name: "Ц", consent: false }]);
    expect(r.errors).toEqual(["Ред 3: неважечка е-пошта „lose-adresa“"]);
    expect(csvContacts("x@y.mk,Марко,Фирма\n").contacts).toEqual([{ email: "x@y.mk", name: "Марко", company: "Фирма", consent: undefined }]);
    expect(csvContacts("").errors[0]).toMatch(/Празна/);
  });
});

describe("segmentWhere", () => {
  it("секогаш ги исклучува одјавените; параметризирано", () => {
    const p: unknown[] = [];
    const w = segmentWhere(segmentRulesSchema.parse({ cities: ["Скопје "], categories: ["fence"], minRevenue: 1000, noOrderDays: 180 }), p);
    expect(w).toContain("c.unsubscribed_at IS NULL");
    expect(w).toContain("mkt_suppressions");
    expect(w).toContain("c.consent_status = 'granted'");
    expect(p).toEqual([["скопје"], ["fence"], 180, 1000]);
    expect(w).not.toContain("Скопје");
    const p2: unknown[] = [];
    expect(segmentWhere(segmentRulesSchema.parse({ consent: "granted_or_customer" }), p2)).toContain("c.customer_id IS NOT NULL AND c.consent_status = 'none'");
  });
});
