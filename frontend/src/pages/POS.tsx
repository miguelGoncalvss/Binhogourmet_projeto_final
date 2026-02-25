import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import PageHeader from "../components/layout/PageHeader";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { formatCurrency, formatDateTime, formatNumber } from "../lib/formatters";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

type Product = {
  id: number;
  name: string;
  sale_price: number;
  unit_label: string;
  is_active: number;
};

type Account = {
  id: number;
  name: string;
};

type CartItem = {
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
};

type OrderListItem = {
  id: number;
  customer_name?: string | null;
  status: string;
  channel: string;
  total_amount: number;
  created_at: string;
};

export default function POS() {
  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [recentOrders, setRecentOrders] = useState<OrderListItem[]>([]);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [channel, setChannel] = useState("balcao");
  const [accountId, setAccountId] = useState<string>("");

  const [creating, setCreating] = useState(false);
  const [stockError, setStockError] = useState<any[] | null>(null);

  async function loadData() {
    const [pRes, aRes, oRes] = await Promise.all([
      api.get<Product[]>("/products"),
      api.get<Account[]>("/accounts"),
      api.get<OrderListItem[]>("/orders"),
    ]);

    setProducts(pRes.data.filter((p) => p.is_active));
    setAccounts(aRes.data);
    setRecentOrders(oRes.data.slice(0, 8));

    if (!accountId && aRes.data.length > 0) {
      setAccountId(String(aRes.data[0].id));
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function addProduct(product: Product) {
    setStockError(null);
    setCart((prev) => {
      const found = prev.find((c) => c.product_id === product.id);
      if (found) {
        return prev.map((c) =>
          c.product_id === product.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          product_name: product.name,
          quantity: 1,
          unit_price: Number(product.sale_price),
        },
      ];
    });
  }

  function updateCartItem(productId: number, patch: Partial<CartItem>) {
    setCart((prev) =>
      prev.map((c) => (c.product_id === productId ? { ...c, ...patch } : c))
    );
  }

  function removeCartItem(productId: number) {
    setCart((prev) => prev.filter((c) => c.product_id !== productId));
  }

  const total = useMemo(
    () => cart.reduce((acc, item) => acc + item.quantity * item.unit_price, 0),
    [cart]
  );

  async function finalizeOrder() {
    if (cart.length === 0) {
      alert("Adicione produtos no carrinho.");
      return;
    }

    setCreating(true);
    setStockError(null);
    try {
      const payload = {
        customer_name: customerName.trim() || null,
        channel,
        order_type: channel === "encomenda" ? "encomenda" : "balcao",
        status: "paid",
        account_id: accountId ? Number(accountId) : null,
        create_financial_transaction: true,
        items: cart.map((item) => ({
          product_id: item.product_id,
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
        })),
      };

      const { data } = await api.post("/orders", payload);

      alert(`Pedido #${data.order.id} criado com sucesso!`);
      setCart([]);
      setCustomerName("");
      await loadData();
    } catch (err: any) {
      if (err?.response?.status === 409 && err?.response?.data?.details) {
        setStockError(err.response.data.details);
      } else {
        alert(err?.response?.data?.error || "Erro ao criar pedido.");
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="PDV"
        description="Frente de caixa rápida para balcão e encomendas."
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Produtos</CardTitle>
          </CardHeader>
          <CardContent>
            {products.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum produto cadastrado.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {products.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => addProduct(product)}
                    className="rounded-xl border p-4 text-left transition hover:bg-muted"
                  >
                    <p className="font-medium">{product.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatCurrency(product.sale_price)} / {product.unit_label}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="sticky top-24 h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              Carrinho
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Cliente</label>
                <Input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Opcional"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Canal</label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                >
                  <option value="balcao">Balcão</option>
                  <option value="encomenda">Encomenda</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="ifood">iFood</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Conta de entrada</label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">Sem conta</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              {cart.length === 0 ? (
                <p className="text-sm text-muted-foreground">Carrinho vazio.</p>
              ) : (
                cart.map((item) => (
                  <div key={item.product_id} className="rounded-lg border p-2">
                    <p className="text-sm font-medium">{item.product_name}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          updateCartItem(item.product_id, {
                            quantity: Math.max(1, item.quantity - 1),
                          })
                        }
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Input
                        type="number"
                        className="h-8"
                        value={item.quantity}
                        onChange={(e) =>
                          updateCartItem(item.product_id, {
                            quantity: Math.max(1, Number(e.target.value || 1)),
                          })
                        }
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          updateCartItem(item.product_id, {
                            quantity: item.quantity + 1,
                          })
                        }
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        step="0.01"
                        value={item.unit_price}
                        onChange={(e) =>
                          updateCartItem(item.product_id, {
                            unit_price: Number(e.target.value || 0),
                          })
                        }
                      />
                      <div className="flex items-center justify-between rounded-md border px-2 text-sm">
                        <span>Total</span>
                        <strong>{formatCurrency(item.quantity * item.unit_price)}</strong>
                      </div>
                    </div>

                    <div className="mt-2 flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeCartItem(item.product_id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {stockError ? (
              <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                <p className="mb-2 font-medium">Estoque insuficiente:</p>
                <ul className="list-disc space-y-1 pl-5">
                  {stockError.map((e, idx) => (
                    <li key={idx}>
                      {e.ingredient_name}: precisa {formatNumber(e.stock_required)} {e.unit}, tem{" "}
                      {formatNumber(e.stock_available)} {e.unit}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between text-sm">
                <span>Total do pedido</span>
                <span className="text-lg font-semibold">{formatCurrency(total)}</span>
              </div>
            </div>

            <Button className="w-full" onClick={finalizeOrder} disabled={creating}>
              {creating ? "Finalizando..." : "Finalizar pedido"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pedidos recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {recentOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem pedidos ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Criado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">#{order.id}</TableCell>
                    <TableCell>{order.customer_name || "Balcão"}</TableCell>
                    <TableCell>{order.channel}</TableCell>
                    <TableCell>{order.status}</TableCell>
                    <TableCell>{formatCurrency(order.total_amount)}</TableCell>
                    <TableCell>{formatDateTime(order.created_at)}</TableCell>
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