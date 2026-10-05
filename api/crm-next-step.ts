/** Чиста логика: следен чекор за потенцијална продажба според фаза и поврзани документи. */
export type NextStep = {
  action: "create_quote" | "open_quote" | "open_order" | "open_delivery" | "open_invoice" | "done" | "lost";
  label: string;
  href?: string;
};

export function nextStepFromTimeline(input: {
  stage: string;
  quote: { id: number; status: string } | null;
  order: { id: number; status: string } | null;
  hasDn: boolean;
  hasInvoice: boolean;
}): NextStep {
  if (input.stage === "lost") return { action: "lost", label: "Изгубена — без следен чекор" };
  if (input.stage === "won" && input.hasInvoice) return { action: "done", label: "Завршено", href: input.order ? `/klienti?order=${input.order.id}` : undefined };
  if (!input.quote) return { action: "create_quote", label: "Направи понуда" };
  if (!input.order) {
    return { action: "open_quote", label: "Отвори понуда", href: `/ponudi?open=${input.quote.id}` };
  }
  if (!input.hasDn) return { action: "open_delivery", label: "Отвори испратници", href: `/ispratnici` };
  if (!input.hasInvoice) return { action: "open_invoice", label: "Отвори фактури", href: `/smetkovodstvo` };
  return { action: "open_order", label: "Отвори нарачка", href: `/klienti?order=${input.order.id}` };
}
