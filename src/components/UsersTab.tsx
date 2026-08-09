import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ROLES, ROLE_ORDER, type Role } from "@contracts/roles";
import { Plus, Pencil, Trash2, Eye, EyeOff, ShieldAlert, UserPlus } from "lucide-react";

function randomCode(): string {
  // Шест цифри — доволно за работилница, лесно за куцање на телефон
  return String(Math.floor(100000 + Math.random() * 900000));
}

export default function UsersTab() {
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "", passcode: randomCode(), role: "operator" as Role, note: "",
  });

  const { data: me } = trpc.appUsers.appUsersMe.useQuery();
  const { data: users, isLoading } = trpc.appUsers.appUsersList.useQuery();

  const onDone = () => {
    utils.appUsers.appUsersList.invalidate();
    setDialogOpen(false);
    setEditing(null);
    setErr(null);
  };

  const createMut = trpc.appUsers.appUsersCreate.useMutation({
    onSuccess: onDone, onError: (e) => setErr(e.message),
  });
  const updateMut = trpc.appUsers.appUsersUpdate.useMutation({
    onSuccess: onDone, onError: (e) => setErr(e.message),
  });
  const deleteMut = trpc.appUsers.appUsersDelete.useMutation({
    onSuccess: () => utils.appUsers.appUsersList.invalidate(),
    onError: (e) => setErr(e.message),
  });

  const reveal = async (id: number) => {
    if (revealed[id]) {
      const next = { ...revealed };
      delete next[id];
      setRevealed(next);
      return;
    }
    const r = await utils.appUsers.appUsersRevealCode.fetch({ id });
    if (r?.passcode) setRevealed({ ...revealed, [id]: r.passcode });
  };

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", passcode: randomCode(), role: "operator", note: "" });
    setErr(null);
    setDialogOpen(true);
  };

  const openEdit = (u: any) => {
    setEditing(u);
    setForm({ name: u.name, passcode: "", role: u.role, note: u.note ?? "" });
    setErr(null);
    setDialogOpen(true);
  };

  const submit = () => {
    if (editing) {
      updateMut.mutate({
        id: editing.id,
        name: form.name,
        role: form.role,
        note: form.note || undefined,
        ...(form.passcode ? { passcode: form.passcode } : {}),
      });
    } else {
      createMut.mutate({
        name: form.name, passcode: form.passcode, role: form.role,
        note: form.note || undefined,
      });
    }
  };

  const isAdmin = me?.role === "admin";

  if (!isAdmin) {
    return (
      <div className="py-16 text-center space-y-2">
        <ShieldAlert className="h-10 w-10 text-amber-500 mx-auto" />
        <p className="font-medium">Само администратор може да ги менува корисниците</p>
        <p className="text-sm text-gray-500">
          Твојата улога е {ROLES[(me?.role ?? "viewer") as Role]?.label}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Објаснување на улогите */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {ROLE_ORDER.slice().reverse().map((r) => (
          <div key={r} className="rounded-lg border bg-white px-4 py-3">
            <div className="font-semibold text-sm">{ROLES[r].label}</div>
            <div className="text-xs text-gray-500 mt-0.5 leading-snug">{ROLES[r].description}</div>
          </div>
        ))}
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-2.5 flex items-center justify-between">
          <span>{err}</span>
          <button onClick={() => setErr(null)} className="text-red-500 px-2">×</button>
        </div>
      )}

      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">
          Секој корисник влегува со свој код. Кодот се внесува на екранот за најава.
        </p>
        <Button className="bg-amber-500 hover:bg-amber-600 text-white" onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" />Нов корисник
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Име</TableHead>
                <TableHead className="w-40">Улога</TableHead>
                <TableHead className="w-40">Код</TableHead>
                <TableHead className="w-28">Статус</TableHead>
                <TableHead className="w-36">Последна активност</TableHead>
                <TableHead className="w-28">Акции</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-400">Вчитување...</TableCell></TableRow>
              ) : !users || users.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-gray-400">
                  Нема корисници. Додека нема ниту еден, сите влегуваат со главната лозинка како администратор.
                </TableCell></TableRow>
              ) : users.map((u: any) => (
                <TableRow key={u.id} className={u.isActive !== "active" ? "opacity-50" : ""}>
                  <TableCell>
                    <div className="font-medium text-sm">{u.name}</div>
                    {u.note && <div className="text-[11px] text-gray-400">{u.note}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      u.role === "admin" ? "border-red-300 text-red-700 bg-red-50"
                        : u.role === "manager" ? "border-blue-300 text-blue-700 bg-blue-50"
                        : u.role === "operator" ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                        : "border-gray-300 text-gray-600"
                    }>{ROLES[u.role as Role]?.label ?? u.role}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm">{revealed[u.id] ?? u.passcodeHint}</span>
                    <button className="ml-2 text-gray-400 hover:text-gray-700 align-middle"
                      onClick={() => reveal(u.id)} title="Прикажи / скриј">
                      {revealed[u.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </TableCell>
                  <TableCell>
                    <button
                      className={`text-xs px-2 py-0.5 rounded border ${
                        u.isActive === "active"
                          ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                          : "border-gray-300 text-gray-500"
                      }`}
                      onClick={() => updateMut.mutate({
                        id: u.id, isActive: u.isActive === "active" ? "inactive" : "active",
                      })}>
                      {u.isActive === "active" ? "Активен" : "Исклучен"}
                    </button>
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">
                    {u.lastSeenAt
                      ? new Date(u.lastSeenAt).toLocaleString("mk-MK", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => openEdit(u)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-500 hover:text-red-600"
                        onClick={() => { if (confirm(`Избриши го корисникот ${u.name}?`)) deleteMut.mutate({ id: u.id }); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400">
        Главната лозинка од подесувањата на серверот и понатаму работи и секогаш е администратор —
        задржи ја како резервен влез ако некој си го заборави кодот.
      </p>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-amber-600" />
              {editing ? `Измени: ${editing.name}` : "Нов корисник"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Име и презиме *</Label>
              <Input value={form.name} autoFocus
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{editing ? "Нов код (остави празно ако не менуваш)" : "Код за влез *"}</Label>
              <div className="flex gap-2">
                <Input className="font-mono" value={form.passcode}
                  placeholder={editing ? "непроменет" : ""}
                  onChange={(e) => setForm({ ...form, passcode: e.target.value })} />
                <Button type="button" variant="outline"
                  onClick={() => setForm({ ...form, passcode: randomCode() })}>Нов</Button>
              </div>
              <p className="text-[11px] text-gray-400">
                Најмалку 4 знака. Шестцифрен број е практичен за куцање на телефон.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Улога</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_ORDER.slice().reverse().map((r) => (
                    <SelectItem key={r} value={r}>{ROLES[r].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-gray-500">{ROLES[form.role].description}</p>
            </div>
            <div className="space-y-2">
              <Label>Забелешка</Label>
              <Input value={form.note} placeholder="на пр. магацин, смена 2"
                onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Откажи</Button>
              <Button className="bg-amber-500 hover:bg-amber-600 text-white"
                disabled={!form.name || (!editing && form.passcode.length < 4) || createMut.isPending || updateMut.isPending}
                onClick={submit}>
                {createMut.isPending || updateMut.isPending ? "Зачувување..." : "Зачувај"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
