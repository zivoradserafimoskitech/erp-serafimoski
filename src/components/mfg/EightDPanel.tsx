import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ListChecks, ChevronDown, ChevronRight } from "lucide-react";

const STEPS: [string, string, string][] = [
  ["d1", "D1 Тим", "Кој работи на проблемот (име, улога)"],
  ["d2", "D2 Опис на проблемот", "Што, каде, кога, колку — со мерки и фотографии"],
  ["d3", "D3 Привремена мерка", "Што направивме веднаш за да го заштитиме клиентот (сортирање, замена...)"],
  ["d4", "D4 Корен на проблемот", "Зошто се случи (5 зошто, Ишикава) — и зошто не беше откриено"],
  ["d5", "D5 Трајна корективна мерка", "Што менуваме за да не се повтори"],
  ["d6", "D6 Спроведување и проверка", "Кога е спроведено, доказ дека делува"],
  ["d7", "D7 Спречување", "Стандарди, упатства, ПФМЕА, обука — за сличните производи"],
  ["d8", "D8 Затворање", "Потврда од клиентот, признание на тимот"],
];

/** 8D извештај (за рекламации од клиенти и добавувачи). D4 и D5 се и „причина“ и „мерка“ на неусогласеноста. */
export default function EightDPanel({ issueId }: { issueId: number }) {
  const [open, setOpen] = useState(false);
  const { data } = trpc.mfg.eightDGet.useQuery({ issueId }, { enabled: open });
  const utils = trpc.useUtils();
  const [d, setD] = useState<Record<string, string>>({});
  useEffect(() => { if (data) setD(data); }, [data]);
  const save = trpc.mfg.eightDSave.useMutation({ onSuccess: () => { toast.success("8D е зачуван"); utils.ops.qualityList.invalidate(); }, onError: (e) => toast.error(e.message) });
  const done = STEPS.filter(([k]) => (d[k] ?? "").trim()).length;
  return (
    <div className="rounded-lg border">
      <button type="button" className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<ListChecks className="h-4 w-4 text-primary" />8D извештај{open ? ` — ${done}/8` : ""}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {STEPS.map(([k, title, hint]) => (
            <div key={k} className="space-y-0.5">
              <p className="text-xs font-semibold">{title}</p>
              <Textarea rows={2} className="text-sm" placeholder={hint} value={d[k] ?? ""} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
            </div>
          ))}
          <div className="flex justify-end"><Button size="sm" disabled={save.isPending} onClick={() => save.mutate({ issueId, d })}>Зачувај 8D</Button></div>
        </div>
      )}
    </div>
  );
}
