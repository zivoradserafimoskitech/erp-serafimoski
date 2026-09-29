import { describe, it, expect } from "vitest";
import { canRun } from "./roles";

describe("дозволи", () => {
  it("секој query е читање", () => {
    expect(canRun("viewer", "finance.trialBalance", "query")).toBe(true);
    expect(canRun("operator", "settings.nextDocNumber", "query")).toBe(true);
  });
  it("пишувањето бара соодветна улога", () => {
    expect(canRun("operator", "accounting.invoiceCreate", "mutation")).toBe(false);
    expect(canRun("manager", "accounting.invoiceCreate", "mutation")).toBe(true);
    expect(canRun("operator", "production.operationCreate", "mutation")).toBe(true);
  });
  it("бришење само администратор", () => {
    expect(canRun("manager", "customers.customerDelete", "mutation")).toBe(false);
    expect(canRun("admin", "customers.customerDelete", "mutation")).toBe(true);
  });
  it("плати и корисници само администратор, и за читање", () => {
    expect(canRun("manager", "hr.employeesList", "query")).toBe(false);
    expect(canRun("admin", "hr.employeesList", "query")).toBe(true);
    expect(canRun("manager", "appUsers.appUsersList", "query")).toBe(false);
    expect(canRun("viewer", "appUsers.appUsersMe", "query")).toBe(true);
  });
});

import { canSeeMenu } from "./roles";
describe("сметководител и мени по улога", () => {
  it("сметководителот пишува во финансии, не во производство", () => {
    expect(canRun("accountant", "accounting.invoiceCreate", "mutation")).toBe(true);
    expect(canRun("accountant", "finance.cashCreate", "mutation")).toBe(true);
    expect(canRun("accountant", "production.operationCreate", "mutation")).toBe(false);
    expect(canRun("accountant", "accounting.invoiceDelete", "mutation")).toBe(false);
    expect(canRun("accountant", "production.workOrderList", "query")).toBe(true);
  });
  it("операторот гледа само подот", () => {
    expect(canSeeMenu("operator", "/proizvodstvo")).toBe(true);
    expect(canSeeMenu("operator", "/finansii")).toBe(false);
    expect(canSeeMenu("accountant", "/finansii")).toBe(true);
    expect(canSeeMenu("accountant", "/proizvodstvo")).toBe(false);
    expect(canSeeMenu("admin", "/vraboteni")).toBe(true);
    expect(canSeeMenu("manager", "/vraboteni")).toBe(false);
  });
});
