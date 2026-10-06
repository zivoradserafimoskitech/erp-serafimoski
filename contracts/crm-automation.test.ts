import { describe, it, expect } from "vitest";
import { planReminders, buildEmailLog, smtpFromEnv, followupDays, digestText } from "./crm-automation";

const base = { today: "2026-10-10", quoteFollowupDays: 3, quotes: [], deals: [], tasks: [] };

describe("planReminders", () => {
  it("follow-up само за пратени понуди постари од N дена", () => {
    const r = planReminders({
      ...base,
      quotes: [
        { id: 1, number: "П-1", customerId: 5, customer: "Метал Про", sentAt: "2026-10-06T10:00:00", status: "sent", opportunityId: 9, owner: "Марко" },
        { id: 2, number: "П-2", customerId: 5, customer: null, sentAt: "2026-10-08", status: "sent", opportunityId: null, owner: null },
        { id: 3, number: "П-3", customerId: 5, customer: null, sentAt: "2026-09-01", status: "accepted", opportunityId: null, owner: null },
      ],
    });
    expect(r.tasks.map((t) => t.autoKey)).toEqual(["quote_followup:1"]);
    expect(r.tasks[0]).toMatchObject({ assignee: "Марко", customerId: 5, opportunityId: 9, quotationId: 1, dueDate: "2026-10-10" });
    expect(r.notifications[0]).toMatchObject({ dedupeKey: "quote_followup:1", recipient: "Марко" });
  });

  it("почитува конфигурирани денови", () => {
    const q = { id: 1, number: "П-1", customerId: 1, customer: null, sentAt: "2026-10-06", status: "sent", opportunityId: null, owner: null };
    expect(planReminders({ ...base, quoteFollowupDays: 5, quotes: [q] }).tasks).toHaveLength(0);
    expect(planReminders({ ...base, quoteFollowupDays: 4, quotes: [q] }).tasks).toHaveLength(1);
  });

  it("зделка со поминат рок → задача, клуч вклучува рок (нов рок = нов потсетник)", () => {
    const r = planReminders({
      ...base,
      deals: [
        { id: 7, title: "Хала", customerId: 2, expectedClose: "2026-10-09", stage: "quoted", owner: "Елена" },
        { id: 8, title: "Ограда", customerId: 2, expectedClose: "2026-10-10", stage: "new", owner: null },
        { id: 9, title: "Стара", customerId: 2, expectedClose: "2026-01-01", stage: "won", owner: null },
      ],
    });
    expect(r.tasks.map((t) => t.autoKey)).toEqual(["deal_overdue:7:2026-10-09"]);
    expect(r.notifications[0].link).toBe("/crm?deal=7");
  });

  it("задачи што доцнат → известување еднаш дневно, без нова задача", () => {
    const r = planReminders({ ...base, tasks: [
      { id: 1, subject: "Јави се", dueDate: "2026-10-09", assignee: "Марко", customerId: 1, opportunityId: null },
      { id: 2, subject: "Денес", dueDate: "2026-10-10", assignee: null, customerId: 1, opportunityId: null },
      { id: 3, subject: "Без рок", dueDate: null, assignee: null, customerId: 1, opportunityId: null },
    ] });
    expect(r.tasks).toHaveLength(0);
    expect(r.notifications.map((n) => n.dedupeKey)).toEqual(["task_overdue:1:2026-10-10"]);
  });

  it("детерминистично — исти клучеви при повторно извршување (идемпотентно)", () => {
    const input = { ...base, deals: [{ id: 7, title: "Хала", customerId: 2, expectedClose: "2026-10-01", stage: "quoted", owner: null }] };
    expect(planReminders(input)).toEqual(planReminders(input));
  });
});

describe("buildEmailLog", () => {
  const contacts = [{ id: 1, email: "Ana@MetalPro.mk" }, { id: 2, email: "ivan@metalpro.mk" }, { id: 3, email: null }];
  it("активност по погоден контакт (to + cc, без разлика на големи букви)", () => {
    const r = buildEmailLog({ to: ["ana@metalpro.mk"], cc: ["ivan@metalpro.mk"], subject: "Понуда П-1", body: "Почитувани", attachment: "Ponuda-P-1.pdf",
      customerId: 5, opportunityId: 9, quotationId: 1, contacts, sentBy: "Марко" });
    expect(r.activities.map((a) => a.contactId)).toEqual([1, 2]);
    expect(r.activities[0]).toMatchObject({ kind: "email", subject: "Е-пошта: Понуда П-1", customerId: 5, opportunityId: 9, quotationId: 1, createdBy: "Марко" });
    expect(r.activities[0].notes).toContain("прилог: Ponuda-P-1.pdf");
    expect(r.log).toMatchObject({ direction: "out", contactId: 1, toAddr: "ana@metalpro.mk", ccAddr: "ivan@metalpro.mk" });
  });
  it("без погоден контакт → една активност на фирмата", () => {
    const r = buildEmailLog({ to: ["drug@x.mk"], subject: "S", body: "B", customerId: 5, opportunityId: null, quotationId: 1, contacts, sentBy: null });
    expect(r.activities).toHaveLength(1);
    expect(r.activities[0].contactId).toBeNull();
    expect(r.log.contactId).toBeNull();
  });
});

describe("smtp/env помошници", () => {
  it("smtpFromEnv", () => {
    expect(smtpFromEnv({})).toBeNull();
    expect(smtpFromEnv({ SMTP_HOST: "smtp.x.mk", SMTP_USER: "u@x.mk", SMTP_PASS: "p" })).toMatchObject({ port: 587, secure: false, from: "u@x.mk", source: "env" });
    expect(smtpFromEnv({ SMTP_HOST: "h", SMTP_PORT: "465", SMTP_FROM: "ERP <erp@x.mk>" })).toMatchObject({ port: 465, secure: true, from: "ERP <erp@x.mk>" });
    expect(smtpFromEnv({ SMTP_HOST: "h", SMTP_PORT: "465", SMTP_SECURE: "false" })?.secure).toBe(false);
  });
  it("followupDays: поставка → env → 3", () => {
    expect(followupDays(undefined)).toBe(3);
    expect(followupDays(undefined, "5")).toBe(5);
    expect(followupDays(7, "5")).toBe(7);
    expect(followupDays(0, "abc")).toBe(3);
  });
  it("digestText", () => {
    const t = digestText("Марко", [{ title: "Понуда П-1 без одговор", link: "/ponudi?open=1" }], "https://erp.x.mk/");
    expect(t).toContain("Здраво Марко");
    expect(t).toContain("https://erp.x.mk/ponudi?open=1");
  });
});
