import { describe, it, expect } from "vitest";
import {
  classifyChannel, leadInputSchema, normalizeLeadFields, spamReason, checkFiles, safeFileName, parseOrigins, hostsOf,
  attributionOf, renderTemplate, feedIssues, buildMetaCsv, buildGoogleXml, MAX_FILE_BYTES, DEFAULT_PUBLIC_ORIGINS, type FeedProduct,
} from "./marketing";

describe("classifyChannel (UTM атрибуција)", () => {
  const own = ["serafimoski.tech"];
  it("Google Ads по gclid или google+cpc", () => {
    expect(classifyChannel({ gclid: "abc" })).toBe("google_ads");
    expect(classifyChannel({ utmSource: "google", utmMedium: "cpc" })).toBe("google_ads");
    expect(classifyChannel({ utmSource: "google", utmMedium: "organic" })).toBe("google");
  });
  it("Meta: реклами само со платен medium; fbclid сам = Facebook", () => {
    expect(classifyChannel({ utmSource: "facebook", utmMedium: "paid_social" })).toBe("facebook_ads");
    expect(classifyChannel({ utmSource: "fb", utmMedium: "social" })).toBe("facebook");
    expect(classifyChannel({ utmSource: "instagram", utmMedium: "cpc" })).toBe("instagram_ads");
    expect(classifyChannel({ utmSource: "ig" })).toBe("instagram");
    expect(classifyChannel({ fbclid: "x" })).toBe("facebook");
  });
  it("е-пошта, LinkedIn, друг извор", () => {
    expect(classifyChannel({ utmSource: "erp", utmMedium: "email" })).toBe("email");
    expect(classifyChannel({ utmSource: "newsletter" })).toBe("email");
    expect(classifyChannel({ utmSource: "linkedin" })).toBe("linkedin");
    expect(classifyChannel({ utmSource: "partner-site" })).toBe("referral");
    expect(classifyChannel({ utmSource: "tiktok", utmMedium: "cpc" })).toBe("other");
  });
  it("без UTM — според referrer; сопствениот домен е „директно“", () => {
    expect(classifyChannel({})).toBe("direct");
    expect(classifyChannel({ referrer: "https://www.google.com/" })).toBe("google");
    expect(classifyChannel({ referrer: "https://l.facebook.com/l.php" })).toBe("facebook");
    expect(classifyChannel({ referrer: "https://www.linkedin.com/feed" })).toBe("linkedin");
    expect(classifyChannel({ referrer: "https://www.serafimoski.tech/#/kontakt", ownHosts: own })).toBe("direct");
    expect(classifyChannel({ referrer: "https://forum.example.mk/t/1" })).toBe("referral");
    expect(classifyChannel({ referrer: "not a url" })).toBe("other");
  });
  it("attributionOf: непознат канал → other", () => {
    expect(attributionOf({ channel: "google_ads", utmMedium: "cpc", utmCampaign: "laser" })).toEqual({ source: "google_ads", medium: "cpc", campaign: "laser" });
    expect(attributionOf({ channel: "xyz" }).source).toBe("other");
  });
});

describe("влез од формата", () => {
  it("snake_case полиња, согласност и нормализација", () => {
    const r = leadInputSchema.parse(normalizeLeadFields({
      name: "  Петар ", email: " Petar@Firma.MK ", product_type: "Ласерско сечење", utm_source: "google", marketing_consent: "on", website: "", junk: "x", files: {},
    }));
    expect(r).toMatchObject({ name: "Петар", email: "petar@firma.mk", productType: "Ласерско сечење", utmSource: "google", consent: true });
    expect(r.company).toBeUndefined();
    expect(leadInputSchema.parse({ name: "Ана", email: "a@b.mk" }).consent).toBe(false);
  });
  it("одбива без име / со погрешна е-пошта", () => {
    expect(leadInputSchema.safeParse({ name: "A", email: "a@b.mk" }).success).toBe(false);
    expect(leadInputSchema.safeParse({ name: "Ана", email: "nema" }).success).toBe(false);
  });
  it("спам хеуристики", () => {
    expect(spamReason({ elapsedMs: 800 })).toMatch(/пребрзо/);
    expect(spamReason({ elapsedMs: 9000, message: "Потребни 200 парчиња" })).toBeNull();
    expect(spamReason({ message: "http://a http://b www.c http://d" })).toMatch(/линкови/);
    expect(spamReason({ name: "http://spam.example" })).toMatch(/името/);
    expect(spamReason({ message: "Cheap SEO services for you" })).toMatch(/спам/);
  });
  it("прилози: тип, големина, број", () => {
    expect(checkFiles([{ name: "del.DXF", size: 1000 }, { name: "crtez.pdf", size: 2000 }, { name: "model.step", size: 10 }])).toBeNull();
    expect(checkFiles([{ name: "virus.exe", size: 10 }])).toMatch(/Недозволен/);
    expect(checkFiles([{ name: "big.pdf", size: MAX_FILE_BYTES + 1 }])).toMatch(/поголема/);
    expect(checkFiles(Array.from({ length: 6 }, (_, i) => ({ name: `${i}.pdf`, size: 1 })))).toMatch(/Најмногу/);
    expect(checkFiles(Array.from({ length: 3 }, (_, i) => ({ name: `${i}.pdf`, size: MAX_FILE_BYTES })))).toMatch(/вкупно|Вкупно|MB/);
    expect(safeFileName("../../etc/passwd")).not.toContain("/");
  });
});

describe("CORS домени", () => {
  it("serafimoski.tech и www се секогаш дозволени; ALLOWED_ORIGINS додава", () => {
    expect(parseOrigins(undefined)).toEqual(DEFAULT_PUBLIC_ORIGINS);
    const o = parseOrigins("https://staging.serafimoski.tech/, http://localhost:5174 ,bad, https://x.mk/path");
    expect(o).toContain("https://www.serafimoski.tech");
    expect(o).toContain("https://staging.serafimoski.tech");
    expect(o).toContain("http://localhost:5174");
    expect(o).not.toContain("bad");
    expect(o.some((x) => x.includes("/path"))).toBe(false);
    expect(parseOrigins("https://a.mk", [])).toEqual(["https://a.mk"]);
    expect(hostsOf(DEFAULT_PUBLIC_ORIGINS)).toEqual(["serafimoski.tech"]);
  });
});

describe("шаблони", () => {
  it("замена на променливи; HTML бегство", () => {
    expect(renderTemplate("Почитувани {{name}}{{product_line}} — {{ nepoznato }}", { name: "Ана", product_line: " за X" })).toBe("Почитувани Ана за X — ");
    expect(renderTemplate("<p>{{name}}</p>", { name: "<b>x</b>" }, { html: true })).toBe("<p>&lt;b&gt;x&lt;/b&gt;</p>");
  });
});

describe("product feed", () => {
  const ok: FeedProduct = { id: 1, code: "OG-1", name: "Ограда, \"Модел А\"", description: "Челична ограда\nпоцинкувана", category: "ограда",
    showOnWeb: true, imageUrl: "https://serafimoski.tech/img/a.jpg", webUrl: "https://serafimoski.tech/#/ograda", publicPrice: 2500 };
  const bad: FeedProduct = { ...ok, id: 2, code: "X-2", imageUrl: "http://insecure/a.jpg", publicPrice: null, description: "" };
  it("feedIssues ги наведува проблемите", () => {
    expect(feedIssues(ok)).toEqual([]);
    expect(feedIssues(bad)).toEqual(["нема https слика", "нема јавна цена", "нема опис"]);
    expect(feedIssues({ ...ok, showOnWeb: false })).toContain("не е означен за веб");
  });
  it("Meta CSV: само исправни, правилно цитирање", () => {
    const csv = buildMetaCsv([ok, bad], { brand: "Serafimoski" });
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("id,title,description,availability,condition,price,link,image_link,brand,product_type");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Ограда, ""Модел А"""');
    expect(lines[1]).toContain("2500.00 MKD");
    expect(lines[1]).toContain("Челична ограда поцинкувана");
  });
  it("Google XML: g: полиња и XML бегство", () => {
    const xml = buildGoogleXml([ok, bad], { brand: "S & S", title: "Каталог", link: "https://serafimoski.tech" });
    expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"');
    expect(xml).toContain("<g:id>OG-1</g:id>");
    expect(xml).not.toContain("<g:id>X-2</g:id>");
    expect(xml).toContain("S &amp; S");
    expect(xml).toContain("&quot;Модел А&quot;");
  });
});
