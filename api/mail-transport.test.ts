import { describe, it, expect, vi, afterEach } from "vitest";
import { smtpFromEnv, getMailer, parseAddress } from "./mail-transport";

describe("mail-transport: избор на провајдер од env", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("SMTP од env: порта 465 = secure, FROM резерва", () => {
    expect(smtpFromEnv({})).toBeNull();
    expect(smtpFromEnv({ SMTP_HOST: "smtp.titan.email", SMTP_PORT: "465", SMTP_USER: "ponudi@serafimoski.tech", SMTP_PASS: "x" }))
      .toMatchObject({ host: "smtp.titan.email", port: 465, secure: true, from: "ponudi@serafimoski.tech", source: "env" });
    expect(smtpFromEnv({ SMTP_HOST: "h", SMTP_USER: "u", MAIL_FROM: "Серафимоски <a@b.mk>" })).toMatchObject({ port: 587, secure: false, from: "Серафимоски <a@b.mk>" });
  });

  it("без ништо → null; само SMTP → smtp", async () => {
    expect(await getMailer({})).toBeNull();
    expect((await getMailer({ SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p" }))?.provider).toBe("smtp");
  });

  it("Brevo преку HTTP API", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messageId: "<m1>" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const m = await getMailer({ MAIL_PROVIDER: "brevo", BREVO_API_KEY: "k", MAIL_FROM: "Серафимоски <ponudi@serafimoski.tech>" });
    expect(m?.provider).toBe("brevo");
    const r = await m!.send({ to: "a@b.mk, c@d.mk", subject: "Тест", text: "x", headers: { "List-Unsubscribe": "<https://x/u>" } });
    expect(r.messageId).toBe("<m1>");
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.headers["api-key"]).toBe("k");
    const body = JSON.parse(init.body);
    expect(body.sender).toEqual({ name: "Серафимоски", email: "ponudi@serafimoski.tech" });
    expect(body.to).toEqual([{ email: "a@b.mk" }, { email: "c@d.mk" }]);
    expect(body.headers["List-Unsubscribe"]).toBe("<https://x/u>");
  });

  it("Mailgun EU + грешка од API", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Forbidden" }), { status: 401 })));
    const m = await getMailer({ MAIL_PROVIDER: "mailgun", MAILGUN_API_KEY: "k", MAILGUN_DOMAIN: "mg.serafimoski.tech", MAILGUN_REGION: "eu", MAIL_FROM: "a@b.mk" });
    expect(m?.provider).toBe("mailgun");
    await expect(m!.send({ to: "x@y.mk", subject: "s", text: "t" })).rejects.toThrow(/Mailgun 401: Forbidden/);
    expect(((globalThis.fetch as any).mock.calls[0][0] as string)).toBe("https://api.eu.mailgun.net/v3/mg.serafimoski.tech/messages");
  });

  it("parseAddress", () => {
    expect(parseAddress('"Серафимоски" <a@b.mk>')).toEqual({ name: "Серафимоски", email: "a@b.mk" });
    expect(parseAddress("a@b.mk")).toEqual({ email: "a@b.mk" });
  });
});
