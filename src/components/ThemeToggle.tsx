import { useEffect, useState } from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyTheme, cycleTheme, getStoredTheme, type ThemeMode } from "@/lib/theme";

const LABEL: Record<ThemeMode, string> = {
  light: "Светла тема",
  dark: "Темна тема",
  system: "Системска тема",
};

/** Циклира light → dark → system. Почитува prefers-color-scheme за system. */
export default function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const stored = getStoredTheme();
    setMode(stored);
    applyTheme(stored);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (getStoredTheme() === "system") applyTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const Icon = mode === "dark" ? Moon : mode === "light" ? Sun : Monitor;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={className}
      title={LABEL[mode]}
      aria-label={LABEL[mode]}
      onClick={() => {
        const next = cycleTheme(mode);
        setMode(next);
        applyTheme(next);
      }}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
