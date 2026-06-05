import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import api from "../services/api";
import PageHeader from "../components/layout/PageHeader";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import {
  formatCurrency,
  formatDateTime,
  getCurrentMonthYear,
  getMonthDateRange,
  getMonthOptions,
} from "../lib/formatters";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Camera, Wallet, FileText } from "lucide-react";

type Account = {
  id: string;
  name: string;
  type: string;
  opening_balance: number;
  current_balance: number;
  is_active: number;
};

type Category = { id: string; name: string; type: "income" | "expense" | "both"; is_personal: number };

type Transaction = {
  id: string;
  type: "income" | "expense";
  amount: number;
  description?: string | null;
  account_id?: string | null;
  category_id?: string | null;
  account_name?: string | null;
  category_name?: string | null;
  occurred_at: string;
  is_personal_withdrawal: number;
};

type DasPayment = {
  id: string;
  year: number;
  month: number;
  status: "pending" | "paid" | "overdue";
  due_date: string;
  paid_at: string | null;
  amount: number | null;
  note: string | null;
};

type DreResponse = {
  dre: {
    revenue: number;
    operational_expenses: number;
    net_profit: number;
    personal_withdrawals: number;
  };
};

type AccountForm = {
  name: string;
  type: string;
  opening_balance: string;
};

type TransactionForm = {
  type: "income" | "expense";
  amount: string;
  description: string;
  account_id: string;
  category_id: string;
  date: string;
  is_personal_withdrawal: boolean;
  affects_mei_revenue: boolean;
};

const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export default function Finance() {
  const current = getCurrentMonthYear();
  const [month, setMonth] = useState(current.month);
  const [year, setYear] = useState(current.year);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [dre, setDre] = useState<DreResponse["dre"] | null>(null);
  
  // ESTADOS DO DAS MEI
  const [dasList, setDasList] = useState<DasPayment[]>([]);
  const [isDasModalOpen, setIsDasModalOpen] = useState(false);
  const [selectedDas, setSelectedDas] = useState<DasPayment | null>(null);
  const [savingDas, setSavingDas] = useState(false);
  const [dasForm, setDasForm] = useState({
    amount: "",
    account_id: "",
    date: new Date().toISOString().slice(0, 10)
  });

  const [loading, setLoading] = useState(true);
  const [savingAccount, setSavingAccount] = useState(false);
  
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  
  const [extracting, setExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [accountForm, setAccountForm] = useState<AccountForm>({
    name: "",
    type: "Conta Corrente",
    opening_balance: "0",
  });

  const [form, setForm] = useState<TransactionForm>({
    type: "expense",
    amount: "",
    description: "",
    account_id: "",
    category_id: "",
    date: new Date().toISOString().slice(0, 10),
    is_personal_withdrawal: false,
    affects_mei_revenue: false,
  });

  const monthOptions = useMemo(() => getMonthOptions(), []);
  const filteredCategories = useMemo(() => {
    return categories.filter((c) => c.type === "both" || c.type === form.type);
  }, [categories, form.type]);

  const totalBalance = useMemo(() => {
    return accounts
      .filter((a) => a.is_active)
      .reduce((acc, curr) => acc + (curr.current_balance || 0), 0);
  }, [accounts]);

  async function loadBase() {
    const [accRes, catRes] = await Promise.all([
      api.get<Account[]>("/accounts"),
      api.get<Category[]>("/categories"),
    ]);

    setAccounts(accRes.data);
    setCategories(catRes.data);

    if (!form.account_id && accRes.data.length > 0) {
      const firstActive = accRes.data.find((a) => a.is_active) || accRes.data[0];
      setForm((s) => ({ ...s, account_id: String(firstActive.id) }));
    }
  }

  async function loadFinanceData() {
    setLoading(true);
    try {
      const { start, end } = getMonthDateRange(year, month);

      const [txRes, dreRes, accRes, dasRes] = await Promise.all([
        api.get<Transaction[]>("/transactions", { params: { from: start, to: end } }),
        api.get<DreResponse>("/finance/dre", { params: { year, month } }),
        api.get<Account[]>("/accounts"),
        api.get<DasPayment[]>("/mei/das", { params: { year } }) // Busca as guias do MEI
      ]);

      setTransactions(txRes.data);
      setDre(dreRes.data.dre);
      setAccounts(accRes.data);
      setDasList(dasRes.data);
      
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBase();
  }, []);

  useEffect(() => {
    loadFinanceData();
  }, [month, year]);

  async function handleCreateAccount(e: FormEvent) {
    e.preventDefault();
    if (!accountForm.name.trim()) return alert("Digite o nome da conta.");

    setSavingAccount(true);
    try {
      await api.post("/accounts", {
        name: accountForm.name.trim(),
        type: accountForm.type,
        opening_balance: Number(accountForm.opening_balance || 0),
        is_active: 1,
      });

      setAccountForm({ name: "", type: "Conta Corrente", opening_balance: "0" });
      await loadBase();
      setIsAccountModalOpen(false);
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao criar conta.");
    } finally {
      setSavingAccount(false);
    }
  }

  async function toggleAccountActive(account: Account) {
    try {
      await api.put(`/accounts/${account.id}`, { ...account, is_active: account.is_active ? 0 : 1 });
      await loadBase();
    } catch (err: any) { alert("Erro ao atualizar conta."); }
  }

  async function deleteAccount(id: string) {
    if (!window.confirm("Excluir esta conta?")) return;
    try {
      await api.delete(`/accounts/${id}`);
      await loadBase();
    } catch (err: any) { alert("Erro ao excluir conta."); }
  }

  async function handleCreateTransaction(e: FormEvent) {
    e.preventDefault();
    if (!form.amount) return alert("Digite o valor.");

    try {
      const isoDate = new Date(`${form.date}T12:00:00`).toISOString();
      await api.post("/transactions", {
        type: form.type,
        amount: Number(form.amount),
        description: form.description || null,
        account_id: form.account_id || null,
        category_id: form.category_id || null,
        occurred_at: isoDate,
        is_personal_withdrawal: form.is_personal_withdrawal ? 1 : 0,
        affects_mei_revenue: form.affects_mei_revenue ? 1 : 0,
      });

      setForm((s) => ({ ...s, amount: "", description: "" }));
      await loadFinanceData();
    } catch (err: any) { alert("Erro ao lançar transação."); }
  }

  async function handleDeleteTransaction(id: string) {
    if (!window.confirm("Excluir este lançamento?")) return;
    try {
      await api.delete(`/transactions/${id}`);
      await loadFinanceData();
    } catch (err: any) { alert(err?.response?.data?.error || "Erro ao excluir lançamento."); }
  }

  async function handleExtractReceipt(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setExtracting(true);
    try {
      const formData = new FormData();
      formData.append("receipt", file);
      const { data } = await api.post("/ingredients/extract-receipt", formData, { headers: { "Content-Type": "multipart/form-data" } });
      const today = new Date().toLocaleDateString("pt-BR");
      const totalFormatted = formatCurrency(data.total_purchase || 0);

      setForm((s) => ({
        ...s,
        type: "expense",
        amount: String(data.total_purchase || ""),
        description: `Compra realizada no dia ${today} e total gasto de ${totalFormatted}`,
      }));
      alert("Nota lida com sucesso! Confira os dados antes de clicar em Lançar.");
    } catch (err: any) {
      alert("Erro ao tentar ler a nota fiscal.");
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ==== FUNÇÕES DO DAS MEI ====
  function openDasModal(das: DasPayment) {
    setSelectedDas(das);
    setDasForm({
      amount: das.amount ? String(das.amount) : "75.60", // Sugestão do valor base do MEI
      account_id: accounts.find(a => a.is_active)?.id ? String(accounts.find(a => a.is_active)?.id) : "",
      date: new Date().toISOString().slice(0, 10)
    });
    setIsDasModalOpen(true);
  }

  async function handlePayDas(e: FormEvent) {
    e.preventDefault();
    if (!selectedDas) return;

    setSavingDas(true);
    try {
      // 1. Atualiza a guia no banco para "Paga"
      await api.put(`/mei/das/${selectedDas.id}`, {
        status: "paid",
        amount: Number(dasForm.amount),
        paid_at: new Date(`${dasForm.date}T12:00:00`).toISOString(),
      });

      // 2. Se escolheu uma conta, lança a despesa direto no financeiro!
      if (dasForm.account_id) {
        await api.post("/transactions", {
          type: "expense",
          amount: Number(dasForm.amount),
          description: `Pagamento Guia DAS MEI - ${MONTH_NAMES[selectedDas.month - 1]}/${selectedDas.year}`,
          account_id: dasForm.account_id,
          category_id: null,
          occurred_at: new Date(`${dasForm.date}T12:00:00`).toISOString(),
          is_personal_withdrawal: 0,
          affects_mei_revenue: 0,
        });
      }

      setIsDasModalOpen(false);
      await loadFinanceData();
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao pagar a guia DAS.");
    } finally {
      setSavingDas(false);
    }
  }

  const activeAccounts = accounts.filter((a) => a.is_active);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        description="Controle de caixa, bancos, DRE simplificado e impostos."
        actions={
          <>
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {[current.year - 1, current.year, current.year + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </>
        }
      />

      {/* BLOCO DO DRE */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Receita (Mês)</CardTitle></CardHeader><CardContent><p className="text-xl font-semibold text-green-600">{formatCurrency(dre?.revenue || 0)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Despesas (Mês)</CardTitle></CardHeader><CardContent><p className="text-xl font-semibold text-red-600">{dre?.operational_expenses ? "-" : ""}{formatCurrency(dre?.operational_expenses || 0)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Lucro Líquido (Mês)</CardTitle></CardHeader><CardContent><p className={`text-xl font-semibold ${(dre?.net_profit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(dre?.net_profit || 0)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Retiradas Pessoais</CardTitle></CardHeader><CardContent><p className="text-xl font-semibold text-red-600">{dre?.personal_withdrawals ? "-" : ""}{formatCurrency(dre?.personal_withdrawals || 0)}</p></CardContent></Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* BLOCO DE CONTAS */}
        <Card>
          <CardHeader className="pb-4 border-b">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Suas Contas</CardTitle>
                <p className="text-sm font-medium text-muted-foreground mt-1">
                  Saldo Total: <span className="text-primary">{formatCurrency(totalBalance)}</span>
                </p>
              </div>
              <Dialog open={isAccountModalOpen} onOpenChange={setIsAccountModalOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-green-600 hover:bg-green-700 text-white shadow-sm">Adicionar+</Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader><DialogTitle>Nova Conta</DialogTitle></DialogHeader>
                  <form className="space-y-4 pt-2" onSubmit={handleCreateAccount}>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Nome da conta</label>
                      <Input value={accountForm.name} onChange={(e) => setAccountForm((s) => ({ ...s, name: e.target.value }))} placeholder="Ex: Nubank PJ" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Tipo da conta</label>
                      <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={accountForm.type} onChange={(e) => setAccountForm((s) => ({ ...s, type: e.target.value }))}>
                        <option>Conta Corrente</option>
                        <option>Poupança</option>
                        <option>Carteira Físico</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Saldo inicial</label>
                      <Input type="number" step="0.01" placeholder="R$ 0,00" value={accountForm.opening_balance} onChange={(e) => setAccountForm((s) => ({ ...s, opening_balance: e.target.value }))} />
                    </div>
                    <div className="flex justify-end gap-2 pt-4 border-t">
                      <Button type="button" variant="outline" onClick={() => setIsAccountModalOpen(false)}>Cancelar</Button>
                      <Button type="submit" className="bg-green-600 hover:bg-green-700 text-white" disabled={savingAccount}>{savingAccount ? "Salvando..." : "Salvar Conta"}</Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-3">
              {accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada.</p>
              ) : (
                accounts.map((acc) => (
                  <div key={acc.id} className={`rounded-lg border p-3 flex flex-col gap-3 ${!acc.is_active ? 'opacity-50' : ''}`}>
                    <div className="flex items-start justify-between">
                      <div><p className="font-medium leading-none mb-1">{acc.name}</p><p className="text-xs text-muted-foreground">{acc.type}</p></div>
                      <div className="text-right">
                        <p className={`font-bold ${acc.current_balance >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(acc.current_balance)}</p>
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground">Saldo Atual</p>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 border-t pt-2">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toggleAccountActive(acc)}>{acc.is_active ? "Inativar" : "Ativar"}</Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:text-red-600" onClick={() => deleteAccount(acc.id)}>Excluir</Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* BLOCO DE NOVO LANÇAMENTO */}
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 border-b mb-4">
            <CardTitle className="text-lg">Novo lançamento</CardTitle>
            <div>
              <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleExtractReceipt} />
              <Button className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm" size="sm" onClick={() => fileInputRef.current?.click()} disabled={extracting}>
                <Camera className="mr-2 h-4 w-4" />{extracting ? "Lendo nota..." : "Ler Nota Fiscal (OCR)"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 md:grid-cols-2" onSubmit={handleCreateTransaction}>
              <div>
                <label className="mb-1 block text-sm font-medium">Tipo</label>
                <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.type} onChange={(e) => setForm((s) => ({ ...s, type: e.target.value as "income" | "expense", category_id: "", affects_mei_revenue: e.target.value === "income" }))}>
                  <option value="expense">Despesa (Saída)</option>
                  <option value="income">Receita (Entrada)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Valor</label>
                <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))} />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Descrição</label>
                <Input value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} placeholder="Ex: Compra de embalagens" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Conta</label>
                <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.account_id} onChange={(e) => setForm((s) => ({ ...s, account_id: e.target.value }))}>
                  <option value="">Sem conta</option>
                  {activeAccounts.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Categoria</label>
                <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.category_id} onChange={(e) => { const categoryId = e.target.value; const cat = categories.find((c) => String(c.id) === categoryId); setForm((s) => ({ ...s, category_id: categoryId, is_personal_withdrawal: s.type === "expense" && cat?.is_personal === 1 ? true : s.is_personal_withdrawal, })); }}>
                  <option value="">Sem categoria</option>
                  {filteredCategories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Data</label>
                <Input type="date" value={form.date} onChange={(e) => setForm((s) => ({ ...s, date: e.target.value }))} />
              </div>
              <div className="rounded-lg border p-3 text-sm flex flex-col justify-center">
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_personal_withdrawal} onChange={(e) => setForm((s) => ({ ...s, is_personal_withdrawal: e.target.checked }))} />Marcar como Retirada pessoal</label>
                <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={form.affects_mei_revenue} onChange={(e) => setForm((s) => ({ ...s, affects_mei_revenue: e.target.checked }))} />Contabilizar no limite do MEI</label>
              </div>
              <div className="md:col-span-2 pt-2">
                <Button type="submit" className="w-full bg-green-600 hover:bg-green-700 text-white">Salvar Lançamento</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* NOVO BLOCO: CONTROLE DO DAS MEI */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Guias DAS MEI ({year})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {dasList.map((das) => (
              <div
                key={das.id}
                onClick={() => das.status !== "paid" ? openDasModal(das) : null}
                className={`border rounded-lg p-3 flex flex-col items-center justify-center text-center transition-all ${
                  das.status === "paid"
                    ? "bg-green-50/50 border-green-200 cursor-default"
                    : "cursor-pointer hover:border-primary hover:bg-muted/30 shadow-sm"
                }`}
              >
                <p className="font-bold text-sm">{MONTH_NAMES[das.month - 1]}</p>
                <p className="text-[10px] text-muted-foreground mb-2">Venc: 20/{String(das.month).padStart(2, "0")}</p>
                
                {das.status === "paid" ? (
                  <Badge className="bg-green-600 hover:bg-green-600">Pago</Badge>
                ) : das.status === "overdue" ? (
                  <Badge variant="destructive">Atrasado</Badge>
                ) : (
                  <Badge variant="secondary" className="border-amber-200 bg-amber-50 text-amber-700">Pendente</Badge>
                )}

                {das.status === "paid" && das.amount && (
                  <p className="text-xs mt-2 font-medium text-green-700">{formatCurrency(das.amount)}</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* MODAL PARA PAGAR O DAS MEI */}
      <Dialog open={isDasModalOpen} onOpenChange={setIsDasModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Pagar Guia DAS</DialogTitle>
          </DialogHeader>
          <form className="space-y-4 pt-2" onSubmit={handlePayDas}>
            <div className="rounded-md bg-muted/50 p-3 text-sm mb-2 text-center">
              <p className="font-semibold">Mês de Referência: {selectedDas ? MONTH_NAMES[selectedDas.month - 1] : ""}/{selectedDas?.year}</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Valor da Guia (R$)</label>
              <Input
                type="number"
                step="0.01"
                value={dasForm.amount}
                onChange={(e) => setDasForm({ ...dasForm, amount: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Data do Pagamento</label>
              <Input
                type="date"
                value={dasForm.date}
                onChange={(e) => setDasForm({ ...dasForm, date: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Conta de saída (opcional)</label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={dasForm.account_id}
                onChange={(e) => setDasForm({ ...dasForm, account_id: e.target.value })}
              >
                <option value="">Não descontar do caixa (Pago por fora)</option>
                {activeAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
                Se escolher uma conta, uma despesa será lançada automaticamente no seu fluxo de caixa de hoje.
              </p>
            </div>
            
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => setIsDasModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="bg-green-600 hover:bg-green-700 text-white" disabled={savingDas}>
                {savingDas ? "Salvando..." : "Confirmar Pagamento"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* BLOCO DE MOVIMENTAÇÕES */}
      <Card>
        <CardHeader>
          <CardTitle>Movimentações do período</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem lançamentos no período.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{formatDateTime(t.occurred_at)}</TableCell>
                    <TableCell>{t.type === "income" ? "Entrada" : "Saída"}</TableCell>
                    <TableCell>{t.description || "-"}</TableCell>
                    <TableCell>{t.category_name || "-"}</TableCell>
                    <TableCell>{t.account_name || "-"}</TableCell>
                    <TableCell className={`text-right font-medium ${t.type === "income" ? "text-green-700" : "text-red-700"}`}>
                      {t.type === "income" ? "+" : "-"} {formatCurrency(t.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="h-8 text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => handleDeleteTransaction(t.id)}>
                        Excluir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}