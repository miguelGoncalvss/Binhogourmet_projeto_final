import { useEffect, useState } from "react";
import api from "../services/api";
import PageHeader from "../components/layout/PageHeader";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Plus, Trash2, History } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { formatCurrency, formatDateTime } from "../lib/formatters";


type Client = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

type ClientForm = {
  name: string;
  phone: string;
  email: string;
  notes: string;
};

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ClientForm>({ name: "", phone: "", email: "", notes: "" });
  const [saving, setSaving] = useState(false);

  // ESTADOS DO HISTÓRICO
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientOrders, setClientOrders] = useState<any[]>([]);
  const [clientStats, setClientStats] = useState({ total_orders: 0, total_spent: 0 });

  async function loadClients() {
    setLoading(true);
    try {
      const { data } = await api.get<Client[]>("/clients");
      setClients(data);
    } finally {
      setLoading(false);
    }
  }

  // A MÁGICA DE ABRIR O HISTÓRICO
  async function openHistory(client: Client) {
    setSelectedClient(client);
    setHistoryOpen(true);
    setClientOrders([]);
    try {
      const { data } = await api.get(`/clients/${client.id}/history`);
      setClientOrders(data.orders);
      setClientStats(data.stats);
    } catch (err) { alert("Erro ao carregar histórico"); }
  }

  useEffect(() => {
    loadClients();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return alert("Nome é obrigatório.");

    setSaving(true);
    try {
      await api.post("/clients", form);
      setForm({ name: "", phone: "", email: "", notes: "" });
      await loadClients();
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao criar cliente.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Excluir cliente? Os pedidos dele continuarão no sistema.")) return;
    try {
      await api.delete(`/clients/${id}`);
      await loadClients();
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao excluir.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Clientes" description="Gerencie sua base de clientes para entregas e encomendas." />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Novo Cliente</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Nome *</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Telefone / WhatsApp</label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">E-mail</label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Anotações (Endereço, preferências...)</label>
                <textarea
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <Button type="submit" className="w-full" disabled={saving}>
                <Plus className="mr-2 h-4 w-4" />
                {saving ? "Salvando..." : "Cadastrar Cliente"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Base de Clientes ({clients.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <p className="text-sm text-muted-foreground">Carregando...</p> : clients.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum cliente cadastrado.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead>Notas</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        {c.phone && <p className="text-sm">{c.phone}</p>}
                        {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">{c.notes || "-"}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => openHistory(c)} className="mr-2">
                          <History className="mr-2 h-4 w-4"/>
                          Histórico
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDelete(c.id)}>
                          <Trash2 className="h-4 w-4" />
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
      {/* POPUP DE HISTÓRICO */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Histórico: {selectedClient?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted/40 p-4 mt-2 mb-4">
            <div>
              <p className="text-sm text-muted-foreground">Total Gasto (Entregue)</p>
              <p className="text-xl font-bold text-primary">{formatCurrency(clientStats.total_spent)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Pedidos (Entregue)</p>
              <p className="text-xl font-bold">{clientStats.total_orders}</p>
            </div>
          </div>
          <div className="max-h-[300px] overflow-y-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientOrders.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center">Nenhuma compra registrada.</TableCell></TableRow>
                ) : 
                  clientOrders.map(o => (
                    <TableRow key={o.id}>
                      <TableCell>#{o.id} - {o.channel}</TableCell>
                      <TableCell>{o.status === 'delivered' ? '✅ Entregue' : '⏳ Na fila'}</TableCell>
                      <TableCell className="font-medium">{formatCurrency(o.total_amount)}</TableCell>
                      <TableCell>{formatDateTime(o.created_at)}</TableCell>
                    </TableRow>
                  ))
                }
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}