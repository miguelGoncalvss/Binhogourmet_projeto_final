import { useEffect, useState } from "react";
import api from "../services/api";
import PageHeader from "../components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { formatCurrency } from "../lib/formatters";
import { ChevronRight, CheckCircle2, ChefHat, Receipt, Clock, GripVertical } from "lucide-react";

type OrderItem = { product_name: string; quantity: number };

type KanbanOrder = {
  id: string;
  display_id?: string;
  order_number?: number;
  customer_name: string | null;
  client_name: string | null;
  channel: string;
  status: "todo" | "prep" | "ready";
  total_amount: number;
  delivery_date: string | null;
  items: OrderItem[];
};

const COLUMNS = [
  { id: "todo", title: "A Fazer", icon: Receipt, color: "border-l-blue-500" },
  { id: "prep", title: "No Forno / Preparo", icon: ChefHat, color: "border-l-amber-500" },
  { id: "ready", title: "Pronto p/ Entrega", icon: CheckCircle2, color: "border-l-emerald-500" },
];

export default function Kanban() {
  const [orders, setOrders] = useState<KanbanOrder[]>([]);
  const [loading, setLoading] = useState(true);

  // Estados para controlar o "Arrastar e Soltar" (Drag and Drop)
  const [draggedOrderId, setDraggedOrderId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  async function loadKanban() {
    try {
      const { data } = await api.get<KanbanOrder[]>("/kanban/orders");
      setOrders(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadKanban();
    const interval = setInterval(loadKanban, 10000); // Atualiza a cozinha a cada 10 segundos
    return () => clearInterval(interval);
  }, []);

  // Função do botão (Avançar / Entregar)
  async function advanceStatus(orderId: string, currentStatus: string) {
    const flow = { todo: "prep", prep: "ready", ready: "delivered" };
    const nextStatus = flow[currentStatus as keyof typeof flow];
    if (!nextStatus) return;

    if (nextStatus === "delivered") {
        if (!window.confirm("Entregar pedido? Isso vai debitar o estoque e registrar o pagamento no caixa.")) return;
    }

    try {
      await api.put(`/orders/${orderId}/status`, { status: nextStatus });
      await loadKanban();
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao atualizar pedido.");
    }
  }

  // Função ao SOLTAR o card na nova coluna
  async function handleDrop(newStatus: string) {
    if (!draggedOrderId) return;
    
    const order = orders.find(o => o.id === draggedOrderId);
    if (!order || order.status === newStatus) return; // Ignora se soltou na mesma coluna

    // Atualização otimista (muda na tela na hora para ficar rápido, depois processa no servidor)
    setOrders(prev => prev.map(o => o.id === draggedOrderId ? { ...o, status: newStatus as any } : o));

    try {
      await api.put(`/orders/${draggedOrderId}/status`, { status: newStatus });
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao mover pedido.");
      await loadKanban(); // Reverte a tela em caso de erro
    } finally {
      setDraggedOrderId(null);
      setDragOverCol(null);
    }
  }

  function isDelayed(dateStr: string | null) {
    if (!dateStr) return false;
    return new Date(dateStr) < new Date();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Cozinha (Kanban)" description="Acompanhe e arraste os pedidos em tempo real." />

      {loading && orders.length === 0 ? (
        <p className="text-muted-foreground">Carregando pedidos...</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => (
            <Card 
              key={col.id} 
              // Eventos da COLUNA (Área de Soltar)
              onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.id); }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => { e.preventDefault(); handleDrop(col.id); }}
              className={`bg-muted/30 transition-all duration-200 ${dragOverCol === col.id ? 'ring-2 ring-primary bg-primary/5' : ''}`}
            >
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <col.icon className="h-5 w-5 text-muted-foreground" />
                  {col.title}
                  <Badge variant="secondary" className="ml-auto">
                    {orders.filter((o) => o.status === col.id).length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              
              <CardContent className="flex flex-col gap-3 min-h-[200px]">
                {orders
                  .filter((o) => o.status === col.id)
                  .map((order) => (
                    <Card 
                      key={order.id} 
                      draggable // Faz o card ser arrastável
                      onDragStart={(e) => {
                        setDraggedOrderId(order.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDraggedOrderId(null);
                        setDragOverCol(null);
                      }}
                      className={`border-l-4 ${col.color} shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow`}
                    >
                      <CardContent className="p-4">
                        <div className="mb-2 flex items-start justify-between">
                          <div className="flex items-start gap-2">
                            <GripVertical className="h-4 w-4 text-muted-foreground/50 mt-0.5" />
                            <div>
                              <p className="font-bold">#{order.display_id || order.id.substring(0, 6)} - {order.client_name || order.customer_name || "Balcão"}</p>
                              <Badge variant="outline" className="mt-1 text-xs">{order.channel}</Badge>
                            </div>
                          </div>
                          <p className="font-semibold text-primary">{formatCurrency(order.total_amount)}</p>
                        </div>
                        {order.delivery_date && (
                          <div className={`mb-3 flex items-center gap-1 text-xs font-semibold pl-6 ${isDelayed(order.delivery_date) && order.status !== 'ready' ? 'text-red-500 animate-pulse' : 'text-muted-foreground'}`}>
                            <Clock className="h-3 w-3" /> 
                            Entrega: {new Date(order.delivery_date).toLocaleString('pt-BR')} 
                            {isDelayed(order.delivery_date) && order.status !== 'ready' && " (ATRASADO!)"}
                          </div>
                        )}
                        <div className="mb-4 space-y-1 rounded-md bg-muted/50 p-2 text-sm ml-6">
                          {order.items.map((item, i) => (
                            <p key={i}>
                              <span className="font-bold">{item.quantity}x</span> {item.product_name}
                            </p>
                          ))}
                        </div>
                        <button
                          onClick={() => advanceStatus(order.id, order.status)}
                          className="flex w-full items-center justify-center rounded-md bg-primary/10 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
                        >
                          {order.status === "ready" ? "Finalizar e Entregar" : "Avançar Etapa"}
                          <ChevronRight className="ml-1 h-4 w-4" />
                        </button>
                      </CardContent>
                    </Card>
                  ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}