import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import PageHeader from "../components/layout/PageHeader";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { formatCurrency, formatNumber } from "../lib/formatters";
import { Plus, Save, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

type Product = {
  id: number;
  name: string;
  sale_price: number;
  unit_label: string;
  is_active: number;
  notes?: string | null;
};

type Ingredient = {
  id: number;
  name: string;
  unit: string;
  cost_per_unit: number;
};

type CompositionItem = {
  ingredient_id: number;
  quantity: number;
  waste_pct: number;
};

type CompositionResponse = {
  product: Product;
  composition: Array<{
    ingredient_id: number;
    quantity: number;
    waste_pct: number;
    ingredient_name: string;
    unit: string;
    cost_per_unit: number;
    ingredient_cost: number;
  }>;
  calculated_cost: number;
  margin_amount: number;
  margin_percent: number;
};

type ProductForm = {
  name: string;
  sale_price: string;
  unit_label: string;
};

// Opções padrão de venda para confeitaria
const PRODUCT_UNIT_OPTIONS = [
  { value: "un", label: "Unidade (un)" },
  { value: "fatia", label: "Fatia" },
  { value: "cento", label: "Cento" },
  { value: "kg", label: "Quilo (kg)" },
  { value: "g", label: "Grama (g)" },
  { value: "L", label: "Litro (L)" },
  { value: "ml", label: "Mililitro (ml)" },
];

export default function Recipes() {
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);

  const [rows, setRows] = useState<CompositionItem[]>([]);
  const [compositionSummary, setCompositionSummary] = useState<CompositionResponse | null>(null);

  const [newProduct, setNewProduct] = useState<ProductForm>({
    name: "",
    sale_price: "0",
    unit_label: "un",
  });

  const [loading, setLoading] = useState(true);
  const [savingComposition, setSavingComposition] = useState(false);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || null,
    [products, selectedProductId]
  );

  async function loadBase() {
    setLoading(true);
    try {
      const [productsRes, ingredientsRes] = await Promise.all([
        api.get<Product[]>("/products"),
        api.get<Ingredient[]>("/ingredients"),
      ]);

      setProducts(productsRes.data);
      setIngredients(ingredientsRes.data);

      if (!selectedProductId && productsRes.data.length > 0) {
        setSelectedProductId(productsRes.data[0].id);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadComposition(productId: number) {
    try {
      const { data } = await api.get<CompositionResponse>(`/products/${productId}/composition`);
      setCompositionSummary(data);
      setRows(
        data.composition.map((c) => ({
          ingredient_id: c.ingredient_id,
          quantity: Number(c.quantity),
          waste_pct: Number(c.waste_pct),
        }))
      );
    } catch (err: any) {
      setCompositionSummary(null);
      setRows([]);
      if (err?.response?.status !== 404) {
        console.error(err);
      }
    }
  }

  useEffect(() => {
    loadBase();
  }, []);

  useEffect(() => {
    if (selectedProductId) {
      loadComposition(selectedProductId);
    }
  }, [selectedProductId]);

  async function handleCreateProduct() {
    if (!newProduct.name.trim()) {
      alert("Digite o nome do produto.");
      return;
    }

    try {
      await api.post("/products", {
        name: newProduct.name.trim(),
        sale_price: Number(newProduct.sale_price || 0),
        unit_label: newProduct.unit_label || "un",
        is_active: 1,
      });

      setNewProduct({ name: "", sale_price: "0", unit_label: "un" });
      await loadBase();
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao criar produto.");
    }
  }

  async function handleUpdateProduct() {
    if (!selectedProduct) return;
    try {
      await api.put(`/products/${selectedProduct.id}`, {
        name: selectedProduct.name,
        sale_price: Number(selectedProduct.sale_price || 0),
        unit_label: selectedProduct.unit_label,
        is_active: selectedProduct.is_active,
      });
      await loadBase();
      await loadComposition(selectedProduct.id);
      alert("Dados do produto atualizados!");
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao atualizar produto.");
    }
  }

  async function handleSaveComposition() {
    if (!selectedProductId) return;

    const validRows = rows.filter((r) => r.ingredient_id && r.quantity > 0);
    if (validRows.length === 0) {
      alert("Adicione ao menos 1 ingrediente na ficha técnica.");
      return;
    }

    setSavingComposition(true);
    try {
      await api.put(`/products/${selectedProductId}/composition`, {
        items: validRows,
      });
      await loadComposition(selectedProductId);
      alert("Ficha técnica salva com sucesso!");
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao salvar ficha técnica.");
    } finally {
      setSavingComposition(false);
    }
  }

  function addRow() {
    const firstIngredient = ingredients[0];
    if (!firstIngredient) {
      alert("Cadastre ingredientes primeiro.");
      return;
    }

    setRows((prev) => [
      ...prev,
      {
        ingredient_id: firstIngredient.id,
        quantity: 0,
        waste_pct: 0,
      },
    ]);
  }

  function updateRow(index: number, patch: Partial<CompositionItem>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  const localEstimatedCost = useMemo(() => {
    return rows.reduce((acc, row) => {
      const ing = ingredients.find((i) => i.id === row.ingredient_id);
      if (!ing) return acc;
      const factor = 1 + Number(row.waste_pct || 0) / 100;
      return acc + Number(row.quantity || 0) * Number(ing.cost_per_unit) * factor;
    }, 0);
  }, [rows, ingredients]);

  const localEstimatedMarginPercent = useMemo(() => {
    if (!selectedProduct) return 0;
    const sale = Number(selectedProduct.sale_price || 0);
    if (sale <= 0) return 0;
    return ((sale - localEstimatedCost) / sale) * 100;
  }, [selectedProduct, localEstimatedCost]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fichas Técnicas"
        description="Monte a composição dos produtos para calcular custo real e margem."
      />

      <div className="grid gap-4 xl:grid-cols-3">
        {/* COLUNA ESQUERDA - LISTA DE PRODUTOS E CRIAÇÃO */}
        <Card>
          <CardHeader>
            <CardTitle>Produtos</CardTitle>
            <CardDescription>Selecione um produto para editar a ficha</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 rounded-lg border p-3">
              <p className="text-sm font-medium">Novo produto</p>
              <Input
                placeholder="Ex: Bolo de Pote Ninho"
                value={newProduct.name}
                onChange={(e) => setNewProduct((s) => ({ ...s, name: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Preço (R$)"
                  value={newProduct.sale_price}
                  onChange={(e) => setNewProduct((s) => ({ ...s, sale_price: e.target.value }))}
                />
                
                {/* AQUI ESTÁ O DROPDOWN PARA NOVO PRODUTO */}
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={newProduct.unit_label}
                  onChange={(e) => setNewProduct((s) => ({ ...s, unit_label: e.target.value }))}
                >
                  {PRODUCT_UNIT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button onClick={handleCreateProduct}>
                <Plus className="mr-2 h-4 w-4" />
                Criar produto
              </Button>
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : (
              <div className="space-y-2">
                {products.map((p) => (
                  <button
                    key={p.id}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      p.id === selectedProductId ? "border-primary bg-primary/5" : "hover:bg-muted"
                    }`}
                    onClick={() => setSelectedProductId(p.id)}
                  >
                    <p className="font-medium">{p.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatCurrency(p.sale_price)} / {p.unit_label}
                    </p>
                  </button>
                ))}
                {products.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum produto cadastrado.</p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        {/* COLUNA DIREITA - EDITOR DA FICHA TÉCNICA */}
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Editor da Ficha Técnica</CardTitle>
            <CardDescription>
              Defina quanto de cada insumo entra no produto final
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedProduct ? (
              <p className="text-sm text-muted-foreground">
                Selecione ou crie um produto para começar.
              </p>
            ) : (
              <>
                <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-4">
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-sm font-medium">Nome</label>
                    <Input
                      value={selectedProduct.name}
                      onChange={(e) =>
                        setProducts((prev) =>
                          prev.map((p) =>
                            p.id === selectedProduct.id ? { ...p, name: e.target.value } : p
                          )
                        )
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Preço de venda</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={selectedProduct.sale_price}
                      onChange={(e) =>
                        setProducts((prev) =>
                          prev.map((p) =>
                            p.id === selectedProduct.id
                              ? { ...p, sale_price: Number(e.target.value || 0) }
                              : p
                          )
                        )
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Unidade de Venda</label>
                    
                    {/* AQUI ESTÁ O DROPDOWN PARA PRODUTO SELECIONADO */}
                    <select
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      value={selectedProduct.unit_label}
                      onChange={(e) =>
                        setProducts((prev) =>
                          prev.map((p) =>
                            p.id === selectedProduct.id ? { ...p, unit_label: e.target.value } : p
                          )
                        )
                      }
                    >
                      {PRODUCT_UNIT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-4 flex justify-end">
                    <Button variant="outline" onClick={handleUpdateProduct}>
                      Salvar dados do produto
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Ingredientes da ficha</p>
                  <Button variant="outline" size="sm" onClick={addRow}>
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar ingrediente
                  </Button>
                </div>

                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ingrediente</TableHead>
                        <TableHead>Quantidade</TableHead>
                        <TableHead>Unidade</TableHead>
                        <TableHead>Perda %</TableHead>
                        <TableHead>Custo/un</TableHead>
                        <TableHead className="text-right">Ação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-sm text-muted-foreground">
                            Produto sem ficha técnica ainda.
                          </TableCell>
                        </TableRow>
                      ) : (
                        rows.map((row, index) => {
                          const ing = ingredients.find((i) => i.id === row.ingredient_id);
                          return (
                            <TableRow key={`${row.ingredient_id}-${index}`}>
                              <TableCell>
                                <select
                                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                                  value={row.ingredient_id}
                                  onChange={(e) =>
                                    updateRow(index, { ingredient_id: Number(e.target.value) })
                                  }
                                >
                                  {ingredients.map((i) => (
                                    <option key={i.id} value={i.id}>
                                      {i.name}
                                    </option>
                                  ))}
                                </select>
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  step="0.0001"
                                  value={row.quantity}
                                  onChange={(e) =>
                                    updateRow(index, { quantity: Number(e.target.value || 0) })
                                  }
                                />
                              </TableCell>
                              <TableCell>{ing?.unit || "-"}</TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={row.waste_pct}
                                  onChange={(e) =>
                                    updateRow(index, { waste_pct: Number(e.target.value || 0) })
                                  }
                                />
                              </TableCell>
                              <TableCell>{formatCurrency(ing?.cost_per_unit || 0)}</TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => removeRow(index)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground">Custo estimado (local)</p>
                      <p className="text-xl font-semibold">{formatCurrency(localEstimatedCost)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground">Margem estimada</p>
                      <p className="text-xl font-semibold">
                        {formatNumber(localEstimatedMarginPercent)}%
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground">Último cálculo salvo</p>
                      <p className="text-xl font-semibold">
                        {formatCurrency(compositionSummary?.calculated_cost || 0)}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSaveComposition} disabled={savingComposition}>
                    <Save className="mr-2 h-4 w-4" />
                    {savingComposition ? "Salvando..." : "Salvar ficha técnica"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}