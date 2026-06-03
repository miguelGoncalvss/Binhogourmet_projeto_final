import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import api from "../services/api";
import PageHeader from "../components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { formatCurrency, formatNumber, getCurrentMonthYear, getMonthOptions } from "../lib/formatters";
import {
  BarChart,
  Bar,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell
} from "recharts";
import { AlertTriangle, Box, DollarSign, Percent, TrendingUp, ChefHat } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

// Paleta de cores para deixar o gráfico mais bonito
const COLORS = [
  "#3b82f6", // Azul
  "#10b981", // Verde
  "#f59e0b", // Amarelo
  "#ef4444", // Vermelho
  "#8b5cf6", // Roxo
  "#ec4899", // Rosa
  "#06b6d4", // Ciano
  "#f97316", // Laranja
  "#84cc16", // Lima
  "#14b8a6", // Teal
];

type DashboardResponse = {
  cards: {
    revenue: number;
    expenses: number;
    net_profit: number;
    personal_withdrawals: number;
  };
  business_margin_percent: number;
  top_products: Array<{
    product_id: number;
    product_name: string;
    qty_sold: number;
    revenue: number;
    cost: number;
    margin: number;
  }>;
  critical_ingredients: Array<{
    id: number;
    name: string;
    unit: string;
    stock_qty: number;
    min_stock_qty: number;
    shortage: number;
  }>;
  monthly_trend: Array<{
    month: string;
    revenue: number;
    expenses: number;
  }>;
  top_clients: Array<{
    client_id: number;
    client_name: string;
    order_count: number;
    total_spent: number;
  }>;
  active_orders?: Array<{
    id: number;
    customer_name: string | null;
    client_name: string | null;
    channel: string;
    status: string;
    total_amount: number;
  }>;
};

type MeiStatus = {
  year: number;
  mei_limit: number;
  business_revenue: number;
  business_expenses: number;
  personal_withdrawals: number;
  remaining_limit: number;
  used_percentage: number;
  alert_level: "ok" | "warning" | "danger";
  das_stats: {
    paid: number;
    pending: number;
    overdue: number;
  };
};

function StatCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: ReactNode;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
          {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="rounded-xl border p-2">{icon}</div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const current = getCurrentMonthYear();
  const [month, setMonth] = useState(current.month);
  const [year, setYear] = useState(current.year);

  const [summary, setSummary] = useState<DashboardResponse | null>(null);
  const [mei, setMei] = useState<MeiStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const monthOptions = useMemo(() => getMonthOptions(), []);

  async function loadDashboard() {
    setLoading(true);
    try {
      const [summaryRes, meiRes] = await Promise.all([
        api.get<DashboardResponse>("/dashboard/summary", { params: { month, year } }),
        api.get<MeiStatus>("/mei/status", { params: { year } }),
      ]);
      setSummary(summaryRes.data);
      setMei(meiRes.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, [month, year]);

  const meiProgress = Math.min(mei?.used_percentage ?? 0, 100);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Visão geral da confeitaria com DRE simplificado, vendas, estoque e MEI."
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

      {loading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Carregando dashboard...
          </CardContent>
        </Card>
      ) : null}

      {!loading && summary ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Receita do mês"
              value={formatCurrency(summary.cards.revenue)}
              subtitle="Entradas registradas"
              icon={<DollarSign className="h-5 w-5" />}
            />
            <StatCard
              title="Despesas do mês"
              value={formatCurrency(summary.cards.expenses)}
              subtitle="Sem retiradas pessoais"
              icon={<TrendingUp className="h-5 w-5" />}
            />
            <StatCard
              title="Lucro líquido"
              value={formatCurrency(summary.cards.net_profit)}
              subtitle="DRE simplificado"
              icon={<Percent className="h-5 w-5" />}
            />
            <StatCard
              title="Margem do negócio"
              value={`${formatNumber(summary.business_margin_percent)}%`}
              subtitle="Com base nos pedidos"
              icon={<Box className="h-5 w-5" />}
            />
          </div>

          {/* BANNER DE ATENÇÃO NA COZINHA */}
          {summary.active_orders && summary.active_orders.length > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-amber-200 p-2">
                  <ChefHat className="h-6 w-6 text-amber-700" />
                </div>
                <div>
                  <p className="font-bold">Atenção na Cozinha!</p>
                  <p className="text-sm">Você tem {summary.active_orders.length} pedido(s) aguardando preparo ou entrega.</p>
                </div>
              </div>
              <Link to="/kanban" className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700">
                Ir para a Cozinha
              </Link>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Top Clientes (Receita)</CardTitle>
              <CardDescription>Quem mais comprou este mês</CardDescription>
            </CardHeader>
            <CardContent>
              {summary.top_clients && summary.top_clients.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem vendas no período.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Pedidos</TableHead>
                      <TableHead className="text-right">Total Gasto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.top_clients?.map((c, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{c.client_name}</TableCell>
                        <TableCell>{c.order_count}</TableCell>
                        <TableCell className="text-right text-primary font-bold">
                          {formatCurrency(c.total_spent)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Receita x Despesas (últimos 6 meses)</CardTitle>
                <CardDescription>Tendência para acompanhar evolução do negócio</CardDescription>
              </CardHeader>
              <CardContent className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={summary.monthly_trend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip
                      formatter={(value: number) => formatCurrency(value)}
                      labelFormatter={(label) => `Mês: ${label}`}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="revenue" name="Receita" strokeWidth={2} />
                    <Line type="monotone" dataKey="expenses" name="Despesas" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>MEI {year}</CardTitle>
                <CardDescription>Limite anual e controle do DAS</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {mei ? (
                  <>
                    <div>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span>Faturamento MEI</span>
                        <span className="font-medium">{formatNumber(mei.used_percentage)}%</span>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${
                            mei.alert_level === "danger"
                              ? "bg-red-500"
                              : mei.alert_level === "warning"
                              ? "bg-yellow-500"
                              : "bg-green-500"
                          }`}
                          style={{ width: `${meiProgress}%` }}
                        />
                      </div>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Limite</span>
                        <span>{formatCurrency(mei.mei_limit)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Faturado</span>
                        <span>{formatCurrency(mei.business_revenue)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Restante</span>
                        <span>{formatCurrency(mei.remaining_limit)}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg border p-2 text-center">
                        <p className="text-xs text-muted-foreground">DAS Pago</p>
                        <p className="text-lg font-semibold">{mei.das_stats.paid}</p>
                      </div>
                      <div className="rounded-lg border p-2 text-center">
                        <p className="text-xs text-muted-foreground">Pendente</p>
                        <p className="text-lg font-semibold">{mei.das_stats.pending}</p>
                      </div>
                      <div className="rounded-lg border p-2 text-center">
                        <p className="text-xs text-muted-foreground">Atrasado</p>
                        <p className="text-lg font-semibold">{mei.das_stats.overdue}</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Sem dados do MEI.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Produtos mais vendidos</CardTitle>
                <CardDescription>Quantidade vendida no período</CardDescription>
              </CardHeader>
              <CardContent className="h-[320px]">
                {summary.top_products.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem vendas no período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={summary.top_products}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="product_name" hide />
                      <YAxis />
                      <Tooltip
                        formatter={(value: number) => formatNumber(value)}
                        labelFormatter={(_, payload) =>
                          payload?.[0]?.payload?.product_name || "Produto"
                        }
                      />
                      <Legend />
                      <Bar dataKey="qty_sold" name="Qtd. vendida" radius={[4, 4, 0, 0]}>
                        {summary.top_products.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Estoque crítico</CardTitle>
                <CardDescription>Insumos abaixo do mínimo</CardDescription>
              </CardHeader>
              <CardContent>
                {summary.critical_ingredients.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                    <Badge className="bg-green-600">OK</Badge>
                    Nenhum insumo em nível crítico.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-amber-700">
                      <AlertTriangle className="h-4 w-4" />
                      {summary.critical_ingredients.length} insumo(s) com atenção.
                    </div>

                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Insumo</TableHead>
                          <TableHead>Atual</TableHead>
                          <TableHead>Mín.</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summary.critical_ingredients.slice(0, 8).map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell>
                              {formatNumber(item.stock_qty)} {item.unit}
                            </TableCell>
                            <TableCell>
                              {formatNumber(item.min_stock_qty)} {item.unit}
                            </TableCell>
                            <TableCell>
                              <Badge variant="destructive">Crítico</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}