import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell, CheckCheck, Clock, FileText, Handshake } from "lucide-react";

const ICON: Record<string, any> = { quote_followup: FileText, deal_overdue: Handshake, task_overdue: Clock };

/** Ѕвонче во заглавјето: CRM известувања од автоматските потсетници. */
export default function NotificationBell() {
  const nav = useNavigate();
  const utils = trpc.useUtils();
  const { data } = trpc.crm.notificationList.useQuery({ limit: 30 }, { refetchInterval: 5 * 60_000, retry: false });
  const read = trpc.crm.notificationRead.useMutation({ onSuccess: () => utils.crm.notificationList.invalidate() });
  const readAll = trpc.crm.notificationReadAll.useMutation({ onSuccess: () => utils.crm.notificationList.invalidate() });
  const unread = data?.unread ?? 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="relative shrink-0 text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-muted" aria-label={`Известувања${unread ? ` (${unread} нови)` : ""}`}>
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-[10px] font-semibold text-white flex items-center justify-center">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-sm font-semibold">Известувања</span>
          {unread > 0 && (
            <button className="text-xs text-primary hover:underline inline-flex items-center gap-1" onClick={() => readAll.mutate()}>
              <CheckCheck className="h-3.5 w-3.5" />Означи сè прочитано
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-auto">
          {!data?.items.length ? (
            <p className="text-sm text-muted-foreground p-4 text-center">Нема известувања</p>
          ) : data.items.map((n) => {
            const Icon = ICON[n.kind] ?? Bell;
            return (
              <button key={n.id} className={`w-full text-left flex gap-2 px-3 py-2 border-b border-border/60 hover:bg-muted ${n.read ? "opacity-60" : ""}`}
                onClick={() => { if (!n.read) read.mutate({ id: n.id }); if (n.link) nav(n.link); }}>
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${n.read ? "text-muted-foreground" : "text-primary"}`} />
                <span className="min-w-0">
                  <span className="block text-sm leading-snug">{n.title}</span>
                  <span className="block text-[11px] text-muted-foreground">{new Date(n.createdAt).toLocaleString("mk-MK", { dateStyle: "short", timeStyle: "short" })}{n.recipient ? ` · ${n.recipient}` : ""}</span>
                </span>
                {!n.read && <span className="ml-auto mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
