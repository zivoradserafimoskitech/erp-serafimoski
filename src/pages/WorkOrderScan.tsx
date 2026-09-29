import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Check, ArrowLeft, AlertCircle, User, Clock, PackageCheck, Package, TriangleAlert, Plus } from "lucide-react";
import { MaterialPicker } from "@/components/MaterialPicker";

const OPERATION_MK: Record<string, string> = {
  cutting_laser: "Ласерско сечење", cutting_plasma: "Плазма сечење", bending: "Виткање",
  welding_mig: "MIG заварување", welding_tig: "TIG заварување", grinding: "Брусење",
  drilling: "Дупчење", painting: "Бојадисување", assembly: "Монтажа",
  quality_control: "Контрола на квалитет", packaging: "Пакување",
};

function fmtMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} ч` : `${h} ч ${r} мин`;
}

function Elapsed({ since }: { since: string | Date }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Date.now() - new Date(since).getTime();
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return (
    <span className="font-mono tabular-nums">
      {h > 0 ? `${h}:` : ""}{String(m).padStart(2, "0")}:{String(sec).padStart(2, "0")}
    </span>
  );
}

export default function WorkOrderScan() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const woId = Number(id);

  const [operator, setOperator] = useState(
    () => window.localStorage.getItem("operatorName") ?? ""
  );
  const [askName, setAskName] = useState(!window.localStorage.getItem("operatorName"));
  const [msg, setMsg] = useState<string | null>(null);
  const [qtyFor, setQtyFor] = useState<number | null>(null);
  const [qty, setQty] = useState("");
  const [finishWo, setFinishWo] = useState(false);
  const [producedQty, setProducedQty] = useState("1");

  const { data: wo, isLoading } = trpc.production.woScanById.useQuery(
    { id: woId },
    { enabled: Number.isFinite(woId) && woId > 0, refetchInterval: 30000 }
  );

  const invalidate = () => {
    utils.production.woScanById.invalidate();
    utils.production.workOrderById.invalidate();
    utils.production.workOrderList.invalidate();
  };

  const clockIn = trpc.production.opClockIn.useMutation({
    onSuccess: (r) => {
      invalidate();
      setMsg(r.alreadyRunning ? "Работата веќе тече" : "Почнато");
    },
  });

  const clockOut = trpc.production.opClockOut.useMutation({
    onSuccess: (r) => {
      invalidate();
      setQtyFor(null);
      setQty("");
      setMsg(`Запишани ${fmtMinutes(r.sessionMinutes)} · вкупно ${fmtMinutes(r.totalMinutes)}`);
      // Последната операција е готова — понуди затворање на налогот
      if (r.allOperationsDone && r.workOrderStatus !== "completed") setFinishWo(true);
    },
  });

  // ---- материјал од подот
  const [issueFor, setIssueFor] = useState<null | { rowId?: number; name?: string; qty: string; unit?: string }>(null);
  const [extraMat, setExtraMat] = useState<any>(null);
  const { data: allMaterials } = trpc.storage.materialList.useQuery(undefined, { enabled: !!issueFor && !issueFor.rowId });
  const floorIssue = trpc.ops.floorIssue.useMutation({
    onSuccess: () => { invalidate(); setIssueFor(null); setExtraMat(null); setMsg("Материјалот е издаден од магацин"); },
    onError: (e) => setMsg(`Грешка: ${e.message}`),
  });
  // ---- пријава на проблем
  const [problem, setProblem] = useState<null | { kind: "product" | "machine"; text: string; machineId: string; downtime: string }>(null);
  const { data: machines } = trpc.ops.machinesForSchedule.useQuery(undefined, { enabled: problem?.kind === "machine" });
  const reportQuality = trpc.ops.qualityCreate.useMutation({
    onSuccess: (r) => { setProblem(null); setMsg(`Пријавено ${r.number} — шефот ќе го види во Квалитет`); },
    onError: (e) => setMsg(`Грешка: ${e.message}`),
  });
  const reportMachine = trpc.ops.maintenanceLogCreate.useMutation({
    onSuccess: () => { setProblem(null); setMsg("Дефектот на машината е пријавен"); },
    onError: (e) => setMsg(`Грешка: ${e.message}`),
  });
  const today = new Date().toISOString().slice(0, 10);

  const closeSessions = trpc.production.closeOpenSessions.useMutation();
  const finishMut = trpc.production.workOrderUpdate.useMutation({
    onSuccess: () => {
      invalidate();
      setFinishWo(false);
      setMsg("Налогот е завршен · готовиот производ е заведен во ГЛ-ПРОД");
    },
    onError: (e) => setMsg(`Грешка: ${e.message}`),
  });

  const finishWorkOrder = async () => {
    await closeSessions.mutateAsync({ workOrderId: woId });
    finishMut.mutate({ id: woId, status: "completed", producedQty } as any);
  };

  const saveName = () => {
    const n = operator.trim();
    if (!n) return;
    window.localStorage.setItem("operatorName", n);
    setAskName(false);
  };

  if (askName) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-5">
        <div className="w-full max-w-sm bg-white rounded-xl border shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-amber-600" />
            <h1 className="font-semibold">Кој си ти?</h1>
          </div>
          <p className="text-sm text-gray-500">
            Името се памти на овој телефон и се запишува на секоја операција.
          </p>
          <Input className="h-12 text-lg" placeholder="Име и презиме" autoFocus
            value={operator} onChange={(e) => setOperator(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveName()} />
          <Button className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-white"
            disabled={!operator.trim()} onClick={saveName}>
            Продолжи
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Вчитување...</div>;
  }

  if (!wo) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertCircle className="h-12 w-12 text-amber-500" />
        <p className="font-semibold">Работниот налог не е пронајден</p>
        <Button variant="outline" onClick={() => navigate("/proizvodstvo")}>
          <ArrowLeft className="h-4 w-4 mr-2" />Кон производство
        </Button>
      </div>
    );
  }

  const ops = (wo.operations ?? []) as any[];
  const runningCount = ops.filter((o) => o.openLog).length;
  const allOpsDone = ops.length > 0 && ops.every((o) => o.status === "completed" || o.status === "skipped");
  const showFinish = finishWo || (allOpsDone && wo.status !== "completed");

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-4">
        {/* Заглавие */}
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-xl font-extrabold text-amber-700">{wo.woNumber}</div>
              <div className="text-sm mt-1 leading-snug">{wo.description}</div>
            </div>
            <Badge variant="outline" className={
              wo.status === "completed" ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                : wo.status === "in_progress" ? "border-blue-300 text-blue-700 bg-blue-50"
                : "border-gray-300 text-gray-600"
            }>
              {wo.status === "completed" ? "Завршен" : wo.status === "in_progress" ? "Во тек" : "Чека"}
            </Badge>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />{operator}
              <button className="text-blue-600 underline ml-1"
                onClick={() => { setAskName(true); }}>смени</button>
            </span>
            {runningCount > 0 && (
              <span className="text-blue-600 font-medium">{runningCount} во тек</span>
            )}
          </div>
        </div>

        {showFinish && (
          <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2 font-semibold text-emerald-900">
              <PackageCheck className="h-5 w-5" />Сите операции се завршени
            </div>
            <p className="text-sm text-emerald-800">
              Затвори го налогот за готовиот производ да влезе во магацинот.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs text-emerald-900">Произведена количина</Label>
              <Input type="number" inputMode="decimal" className="h-12 text-lg text-center bg-white"
                value={producedQty} onChange={(e) => setProducedQty(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-12 bg-white"
                onClick={() => setFinishWo(false)}>Подоцна</Button>
              <Button className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={finishMut.isPending || closeSessions.isPending}
                onClick={finishWorkOrder}>
                {finishMut.isPending ? "..." : "Заврши налог"}
              </Button>
            </div>
          </div>
        )}

        {msg && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl px-4 py-3 flex items-center justify-between">
            <span>{msg}</span>
            <button onClick={() => setMsg(null)} className="text-emerald-500 px-2">×</button>
          </div>
        )}

        {/* Операции */}
        {ops.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">
            Нема дефинирани операции на овој налог.
          </div>
        ) : ops.map((op) => {
          const running = !!op.openLog;
          const done = op.status === "completed";
          const estH = Number(op.estimatedTime ?? 0) || 0;
          const loggedMin = op.loggedMinutes ?? 0;
          const over = estH > 0 && loggedMin / 60 > estH;

          return (
            <div key={op.id} className={`bg-white rounded-xl border shadow-sm p-4 ${
              running ? "border-blue-300 ring-2 ring-blue-100" : done ? "opacity-70" : ""
            }`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold">
                    <span className="text-gray-400 mr-1.5">{op.sequence}.</span>
                    {OPERATION_MK[op.operation] ?? op.operation}
                  </div>
                  {op.description && (
                    <div className="text-xs text-gray-500 mt-0.5 leading-snug">{op.description}</div>
                  )}
                </div>
                {done && <Check className="h-5 w-5 text-emerald-600 shrink-0" />}
              </div>

              <div className="mt-3 flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1.5 text-gray-600">
                  <Clock className="h-4 w-4 text-gray-400" />
                  {running ? (
                    <span className="text-blue-700 font-bold text-lg">
                      <Elapsed since={op.openLog.startedAt} />
                    </span>
                  ) : (
                    <span className={over ? "text-red-600 font-medium" : ""}>
                      {loggedMin > 0 ? fmtMinutes(loggedMin) : "—"}
                    </span>
                  )}
                </span>
                {estH > 0 && (
                  <span className="text-xs text-gray-400">план {fmtMinutes(estH * 60)}</span>
                )}
              </div>

              {op.operators?.length > 0 && (
                <div className="mt-1 text-[11px] text-gray-400">{op.operators.join(", ")}</div>
              )}

              {qtyFor === op.id ? (
                <div className="mt-3 space-y-2">
                  <Label className="text-xs">Изработена количина {op.qtyUnit ? `(${op.qtyUnit})` : ""}</Label>
                  <Input type="number" inputMode="decimal" className="h-12 text-lg text-center"
                    placeholder={op.estimatedQty ? `план ${op.estimatedQty}` : "0"}
                    value={qty} autoFocus onChange={(e) => setQty(e.target.value)} />
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1 h-11"
                      onClick={() => { setQtyFor(null); setQty(""); }}>Назад</Button>
                    <Button className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={clockOut.isPending}
                      onClick={() => clockOut.mutate({
                        operationId: op.id, finish: true,
                        actualQty: qty || undefined,
                      })}>
                      <Check className="h-4 w-4 mr-1.5" />Заврши
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  {!done && !running && (
                    <Button className="flex-1 h-12 bg-blue-600 hover:bg-blue-700 text-white"
                      disabled={clockIn.isPending}
                      onClick={() => clockIn.mutate({ operationId: op.id, operator })}>
                      <Play className="h-4 w-4 mr-1.5" />Почни
                    </Button>
                  )}
                  {running && (
                    <>
                      <Button variant="outline" className="flex-1 h-12"
                        disabled={clockOut.isPending}
                        onClick={() => clockOut.mutate({ operationId: op.id, finish: false })}>
                        <Pause className="h-4 w-4 mr-1.5" />Пауза
                      </Button>
                      <Button className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => { setQtyFor(op.id); setQty(""); }}>
                        <Check className="h-4 w-4 mr-1.5" />Готово
                      </Button>
                    </>
                  )}
                  {done && (
                    <Button variant="outline" className="flex-1 h-11 text-gray-500"
                      disabled={clockIn.isPending}
                      onClick={() => clockIn.mutate({ operationId: op.id, operator })}>
                      <Play className="h-4 w-4 mr-1.5" />Продолжи повторно
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Материјал */}
        <div className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
          <div className="flex items-center gap-2 font-semibold"><Package className="h-5 w-5 text-amber-600" />Материјал</div>
          {(wo.materials ?? []).length === 0 && <p className="text-sm text-gray-400">Нема планиран материјал.</p>}
          {(wo.materials ?? []).map((m: any) => {
            const issued = m.isActual === "actual";
            return (
              <div key={m.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{m.name}</div>
                  <div className="text-xs text-gray-500">{parseFloat(m.quantity)} {m.unit}</div>
                </div>
                {issued ? (
                  <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50">Издадено</Badge>
                ) : (
                  <Button className="h-11 bg-amber-500 hover:bg-amber-600 text-white" disabled={wo.status === "completed"}
                    onClick={() => setIssueFor({ rowId: m.id, name: m.name, qty: String(parseFloat(m.quantity)), unit: m.unit })}>Земи од магацин</Button>
                )}
              </div>
            );
          })}
          {wo.status !== "completed" && (
            <Button variant="outline" className="w-full h-11" onClick={() => { setExtraMat(null); setIssueFor({ qty: "" }); }}>
              <Plus className="h-4 w-4 mr-1.5" />Земи друг материјал
            </Button>
          )}
        </div>

        {issueFor && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={() => setIssueFor(null)}>
            <div className="w-full max-w-md bg-white rounded-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="font-semibold text-lg">{issueFor.rowId ? issueFor.name : "Друг материјал"}</div>
              {!issueFor.rowId && (
                <MaterialPicker materials={(allMaterials ?? []) as any} value={extraMat ? String(extraMat.id) : null}
                  placeholder="Пребарај материјал…" title="Избери материјал" onSelect={(m: any) => { setExtraMat(m); setIssueFor({ ...issueFor, unit: m.unit }); }} />
              )}
              <div className="space-y-1.5">
                <Label className="text-sm">Количина {issueFor.unit ? `(${issueFor.unit})` : ""}</Label>
                <Input type="number" inputMode="decimal" className="h-14 text-2xl text-center" autoFocus
                  value={issueFor.qty} onChange={(e) => setIssueFor({ ...issueFor, qty: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-12" onClick={() => setIssueFor(null)}>Откажи</Button>
                <Button className="flex-1 h-12 bg-amber-500 hover:bg-amber-600 text-white"
                  disabled={floorIssue.isPending || !(parseFloat(issueFor.qty) > 0) || (!issueFor.rowId && !extraMat)}
                  onClick={() => floorIssue.mutate({ workOrderId: woId, woMaterialId: issueFor.rowId, materialId: extraMat?.id, quantity: parseFloat(issueFor.qty), operator })}>
                  {floorIssue.isPending ? "..." : "Издај"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Пријави проблем */}
        <Button variant="outline" className="w-full h-12 border-red-200 text-red-700 hover:bg-red-50"
          onClick={() => setProblem({ kind: "product", text: "", machineId: "", downtime: "" })}>
          <TriangleAlert className="h-4 w-4 mr-2" />Пријави проблем
        </Button>

        {problem && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={() => setProblem(null)}>
            <div className="w-full max-w-md bg-white rounded-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="font-semibold text-lg flex items-center gap-2"><TriangleAlert className="h-5 w-5 text-red-600" />Пријави проблем</div>
              <div className="grid grid-cols-2 gap-2">
                {([["product", "Дефект на производ"], ["machine", "Дефект на машина"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setProblem({ ...problem, kind: k })}
                    className={`h-12 rounded-xl border text-sm font-medium ${problem.kind === k ? "border-red-400 bg-red-50 text-red-800" : "text-gray-600"}`}>{l}</button>
                ))}
              </div>
              {problem.kind === "machine" && (
                <div className="space-y-2">
                  <select className="w-full h-12 rounded-lg border px-3 bg-white" value={problem.machineId} onChange={(e) => setProblem({ ...problem, machineId: e.target.value })}>
                    <option value="">Која машина?</option>
                    {machines?.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <Input type="number" inputMode="decimal" className="h-12" placeholder="Колку часа стои машината? (ако знаеш)"
                    value={problem.downtime} onChange={(e) => setProblem({ ...problem, downtime: e.target.value })} />
                </div>
              )}
              <textarea className="w-full min-h-[110px] rounded-lg border p-3 text-base" placeholder={problem.kind === "product" ? "Што не е во ред? (на пр. погрешна мера, 5 парчиња)" : "Што се случи со машината?"}
                value={problem.text} onChange={(e) => setProblem({ ...problem, text: e.target.value })} />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-12" onClick={() => setProblem(null)}>Откажи</Button>
                <Button className="flex-1 h-12 bg-red-600 hover:bg-red-700 text-white"
                  disabled={problem.text.trim().length < 3 || (problem.kind === "machine" && !problem.machineId) || reportQuality.isPending || reportMachine.isPending}
                  onClick={() => problem.kind === "product"
                    ? reportQuality.mutate({ date: today, kind: "internal", title: problem.text.trim().slice(0, 120), description: `${problem.text.trim()}\n\nПријавил: ${operator} (од телефон)`, workOrderId: woId, responsible: operator })
                    : reportMachine.mutate({ machineId: Number(problem.machineId), date: today, kind: "breakdown", description: `${problem.text.trim()} · налог ${wo.woNumber}`, downtimeHours: parseFloat(problem.downtime) || 0, performedBy: operator })}>
                  Пријави
                </Button>
              </div>
            </div>
          </div>
        )}

        <Button variant="outline" className="w-full h-12" onClick={() => navigate("/proizvodstvo")}>
          <ArrowLeft className="h-4 w-4 mr-2" />Кон производство
        </Button>
      </div>
    </div>
  );
}
