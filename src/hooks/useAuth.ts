import { useCallback, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { logout as appLogout } from "@/lib/auth";

/** Автентикација преку PasswordGate / x-app-key сесија (не Kimi OAuth). */
export function useAuth(_options?: { redirectOnUnauthenticated?: boolean; redirectPath?: string }) {
  const { data: me, isLoading, error, refetch } = trpc.appUsers.appUsersMe.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  const logout = useCallback(() => {
    void appLogout();
  }, []);

  return useMemo(
    () => ({
      user: me ? { name: me.name, role: me.role, id: me.id } : null,
      isAuthenticated: !!me && me.gate !== false ? !!me.name : !!me,
      isLoading,
      error,
      logout,
      refresh: refetch,
    }),
    [me, isLoading, error, logout, refetch],
  );
}
