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

function humanizeError(err: any): string {
  const msg = err?.message ?? "Непозната грешка";
  try {
    const issues = JSON.parse(msg);
    if (Array.isArray(issues)) {
      return issues.map((i: any) => {
        const field = (i.path ?? []).join(".");
        if (i.format === "email") return `Полето „${field}" не е валиден email`;
        return field ? `${field}: ${i.message}` : i.message;
      }).join("; ");
    }
  } catch { /* не е zod JSON */ }
  return msg.slice(0, 300);
}

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
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
