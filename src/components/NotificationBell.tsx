// Ѕвонче со известувања во апликацијата (ново барање од веб и сл.).
import { useState } from "react";
import { useNavigate } from "react-router";
import { Bell, CheckCheck } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateTime, cn } from "@/lib/utils";

export default function NotificationBell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data } = trpc.notifications.notificationList.useQuery({ limit: 30 }, { refetchInterval: 60_000, refetchOnWindowFocus: true, retry: false });
  const markRead = trpc.notifications.notificationRead.useMutation({ onSuccess: () => utils.notifications.notificationList.invalidate() });
  const markAll = trpc.notifications.notificationReadAll.useMutation({ onSuccess: () => utils.notifications.notificationList.invalidate() });
  const unread = data?.unread ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn("relative rounded-md p-2 hover:bg-muted", className)} aria-label={`Известувања${unread ? ` (${unread} непрочитани)` : ""}`} title="Известувања">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-[1.1rem] text-white">{unread > 99 ? "99+" : unread}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Известувања</span>
          {unread > 0 && (
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => markAll.mutate()}>
              <CheckCheck className="h-3.5 w-3.5" /> Сите прочитани
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-auto">
          {!data?.items.length && <div className="px-3 py-6 text-center text-sm text-muted-foreground">Нема известувања</div>}
          {data?.items.map((n) => (
            <button key={n.id}
              className={cn("block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted", !n.read && "bg-blue-50/60 dark:bg-blue-950/30")}
              onClick={() => { if (!n.read) markRead.mutate({ id: n.id }); setOpen(false); if (n.link) navigate(n.link); }}>
              <div className={cn("leading-snug", !n.read && "font-medium")}>{n.title}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
