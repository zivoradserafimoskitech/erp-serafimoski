import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { toast } from "sonner";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();

// Backend URL
// Автоматски детектирај го URL-от од тековниот домен
const API_URL = import.meta.env.VITE_API_URL || `${window.location.origin}/api/trpc`;

// Имиња на полињата за пораките (zod ги враќа на англиски)
const FIELD_MK: Record<string, string> = {
  name: "Назив", code: "Шифра", role: "Улога", roleCode: "Шифра на улога", costPerHour: "Цена по час", rateValue: "Вредност",
  fromUnitId: "Од единица", toUnitId: "Во единица", factor: "Фактор", email: "Е-пошта", phone: "Телефон",
  supplierId: "Добавувач", customerId: "Клиент", materialId: "Материјал", warehouseId: "Магацин", quantity: "Количина",
  unitPrice: "Цена", description: "Опис", invoiceNumber: "Број на фактура", supplierInvoiceNumber: "Број од добавувач",
  receiptNumber: "Број на приемница", poNumber: "Број на нарачка", woNumber: "Број на налог", quoteNumber: "Број на понуда",
  receivedDate: "Датум на прием", issueDate: "Датум", edb: "ЕДБ", title: "Наслов", amount: "Износ", txDate: "Датум",
};
const fieldLabel = (path: any[]) => {
  const parts = (path ?? []).filter((x) => typeof x === "string");
  const last = parts[parts.length - 1] ?? "";
  const idx = (path ?? []).find((x) => typeof x === "number");
  return `${FIELD_MK[last] ?? last}${typeof idx === "number" ? ` (ред ${idx + 1})` : ""}`;
};

function humanizeError(err: any): string {
  const msg = err?.message ?? "Непозната грешка";
  try {
    const issues = JSON.parse(msg);
    if (Array.isArray(issues)) {
      return issues.map((i: any) => {
        const f = fieldLabel(i.path);
        if (i.format === "email") return `„${f}“ не е валидна е-пошта`;
        if (i.code === "too_small" && (i.minimum === 1 || i.minimum === 1n) && i.origin === "string") return `„${f}“ е задолжително`;
        if (i.code === "too_small") return `„${f}“ е премало (најмалку ${i.minimum})`;
        if (i.code === "too_big") return `„${f}“ е преголемо (најмногу ${i.maximum})`;
        if (i.code === "invalid_type") return `„${f}“ не е пополнето или избрано`;
        if (i.code === "invalid_value" || i.code === "invalid_enum_value") return `„${f}“ има невалидна вредност`;
        return f ? `${f}: ${i.message}` : i.message;
      }).join("; ");
    }
  } catch { /* не е zod JSON */ }
  return msg.slice(0, 300);
}

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // податоците се освежуваат сами: при враќање во прозорецот и секоја минута додека страницата е отворена
      refetchOnWindowFocus: true,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      staleTime: 5_000,
    },
  },
  mutationCache: new MutationCache({
    // секое зачувување (налог, уплата, фактура...) ги освежува сите модули -- добивка, тек, табла, главна книга
    onSuccess: () => { queryClient.invalidateQueries(); },
    onError: (error) => {
      toast.error("Зачувувањето не успеа", { description: humanizeError(error) });
      console.error("[mutation error]", error);
    },
  }),
});
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      headers() {
        const k = window.localStorage.getItem("appKey");
        return k ? { "x-app-key": k } : {};
      },
      url: API_URL,
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
