import { FormEvent, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import PageHeader from "../components/layout/PageHeader";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import {
  formatCurrency,
  formatDateTime,
  getCurrentMonthYear,
  getMonthDateRange,
  getMonthOptions,
} from "../lib/formatters";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

type Account = {
  id: number;
  name: string;
  type: string;
  opening_balance: number;
  is_active: number;
};

type Category = { id: number; name: string; type: "income" | "expense" | "both"; is_personal: number };

type Transaction = {
  id: number;
  type: "income" | "expense";
  amount: number;
  description?: string | null;
  account_id?: number | null;
  category_id?: number | null;
  account_name?: string | null;
  category_name?: string | null;
  occurred_at: string;
  is_personal_withdrawal: number;
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

export default function Finance() {
  const current = getCurrentMonthYear();
  const [month, setMonth] = useState(current.month);
  const [year, setYear] = useState(current.year);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [dre, setDre] = useState<DreResponse["dre"] | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingAccount, setSavingAccount] = useState(false);

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

      const [txRes, dreRes] = await Promise.all([
        api.get<Transaction[]>("/transactions", { params: { from: start, to: end } }),
        api.get<DreResponse>("/finance/dre", { params: { year, month } }),
      ]);

      setTransactions(txRes.data);
      setDre(dreRes.data.dre);
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
    if (!accountForm.name.trim()) {
      alert("Digite o nome da conta.");
      return;
    }

    setSavingAccount(true);
    try {
      await api.post("/accounts", {
        name: accountForm.name.trim(),
        type: accountForm.type,
        opening_balance: Number(accountForm.opening_balance || 0),
        is_active: 1,
      });

      setAccountForm({
        name: "",
        type: "Conta Corrente",
        opening_balance: "0",
      });

      await loadBase();
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao criar conta.");
    } finally {
      setSavingAccount(false);
    }
  }

  async function toggleAccountActive(account: Account) {
    try {
      await api.put(`/accounts/${account.id}`, {
        ...account,
        is_active: account.is_active ? 0 : 1,
      });
      await loadBase();
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao atualizar conta.");
    }
  }

  async function deleteAccount(id: number) {
    if (!window.confirm("Excluir esta conta?")) return;
    try {
      await api.delete(`/accounts/${id}`);
      await loadBase();
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao excluir conta.");
    }
  }

  async function handleCreateTransaction(e: FormEvent) {
    e.preventDefault();

    if (!form.amount) {
      alert("Digite o valor.");
      return;
    }

    try {
      const isoDate = new Date(`${form.date}T12:00:00`).toISOString();

      await api.post("/transactions", {
        type: form.type,
        amount: Number(form.amount),
        description: form.description || null,
        account_id: form.account_id ? Number(form.account_id) : null,
        category_id: form.category_id ? Number(form.category_id) : null,
        occurred_at: isoDate,
        is_personal_withdrawal: form.is_personal_withdrawal ? 1 : 0,
        affects_mei_revenue: form.affects_mei_revenue ? 1 : 0,
      });

      setForm((s) => ({
        ...s,
        amount: "",
        description: "",
      }));

      await loadFinanceData();
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao lançar transação.");
    }
  }

  async function handleDeleteTransaction(id: number) {
    if (!window.confirm("Excluir este lançamento?")) return;

    try {
      await api.delete(`/transactions/${id}`);
      await loadFinanceData();
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao excluir lançamento.");
    }
  }

  const activeAccounts = accounts.filter((a) => a.is_active);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        description="Contas bancárias, lançamentos e DRE simplificado."
        actions={
          <>
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>

            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {[current.year - 1, current.year, current.year + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Receita</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold">{formatCurrency(dre?.revenue || 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Despesas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold">
              {formatCurrency(dre?.operational_expenses || 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Lucro Líquido</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold">{formatCurrency(dre?.net_profit || 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Retiradas Pessoais</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold">
              {formatCurrency(dre?.personal_withdrawals || 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Contas Bancárias</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-3" onSubmit={handleCreateAccount}>
              <div>
                <label className="mb-1 block text-sm font-medium">Nome da conta</label>
                <Input
                  value={accountForm.name}
                  onChange={(e) => setAccountForm((s) => ({ ...s, name: e.target.value }))}
                  placeholder="Ex: Nubank PJ"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Tipo</label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={accountForm.type}
                  onChange={(e) => setAccountForm((s) => ({ ...s, type: e.target.value }))}
                >
                  <option>Conta Corrente</option>
                  <option>Poupança</option>
                  <option>Carteira</option>
                  <option>Caixa Físico</option>
                  <option>Outro</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Saldo inicial (opcional)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={accountForm.opening_balance}
                  onChange={(e) =>
                    setAccountForm((s) => ({ ...s, opening_balance: e.target.value }))
                  }
                />
              </div>

              <Button type="submit" className="w-full" disabled={savingAccount}>
                {savingAccount ? "Salvando..." : "Criar conta"}
              </Button>
            </form>

            <div className="space-y-2">
              {accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada.</p>
              ) : (
                accounts.map((acc) => (
                  <div key={acc.id} className="rounded-lg border p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{acc.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {acc.type} • Saldo inicial: {formatCurrency(acc.opening_balance || 0)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => toggleAccountActive(acc)}>
                          {acc.is_active ? "Inativar" : "Ativar"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => deleteAccount(acc.id)}>
                          Excluir
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Novo lançamento</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 md:grid-cols-2" onSubmit={handleCreateTransaction}>
              <div>
                <label className="mb-1 block text-sm font-medium">Tipo</label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.type}
                  onChange={(e) =>
                    setForm((s) => ({
                      ...s,
                      type: e.target.value as "income" | "expense",
                      category_id: "",
                      affects_mei_revenue: e.target.value === "income",
                    }))
                  }
                >
                  <option value="expense">Despesa</option>
                  <option value="income">Receita</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Valor</label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))}
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Descrição</label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
                  placeholder="Ex: Compra de embalagens"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Conta</label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.account_id}
                  onChange={(e) => setForm((s) => ({ ...s, account_id: e.target.value }))}
                >
                  <option value="">Sem conta</option>
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Categoria</label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.category_id}
                  onChange={(e) => {
                    const categoryId = e.target.value;
                    const cat = categories.find((c) => String(c.id) === categoryId);
                    setForm((s) => ({
                      ...s,
                      category_id: categoryId,
                      is_personal_withdrawal:
                        s.type === "expense" && cat?.is_personal === 1 ? true : s.is_personal_withdrawal,
                    }));
                  }}
                >
                  <option value="">Sem categoria</option>
                  {filteredCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Data</label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((s) => ({ ...s, date: e.target.value }))}
                />
              </div>

              <div className="rounded-lg border p-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.is_personal_withdrawal}
                    onChange={(e) =>
                      setForm((s) => ({ ...s, is_personal_withdrawal: e.target.checked }))
                    }
                  />
                  Retirada pessoal
                </label>

                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.affects_mei_revenue}
                    onChange={(e) =>
                      setForm((s) => ({ ...s, affects_mei_revenue: e.target.checked }))
                    }
                  />
                  Conta no faturamento MEI
                </label>
              </div>

              <div className="md:col-span-2">
                <Button type="submit" className="w-full">
                  Lançar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

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
                  <TableHead>Valor</TableHead>
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
                    <TableCell className={t.type === "income" ? "text-green-700" : "text-red-700"}>
                      {t.type === "income" ? "+" : "-"} {formatCurrency(t.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => handleDeleteTransaction(t.id)}>
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