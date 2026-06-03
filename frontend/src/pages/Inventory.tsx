import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import PageHeader from "../components/layout/PageHeader";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { formatCurrency, formatNumber } from "../lib/formatters";
import { Plus, ShoppingCart, Trash2, CheckCircle2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

type MeasurementType = "mass" | "volume" | "unit";
type UnitOption = "mg" | "g" | "kg" | "ml" | "L" | "un";

type Ingredient = {
  id: number;
  name: string;
  measurement_type: MeasurementType;
  base_unit: UnitOption;
  stock_qty_base: number;
  min_stock_qty_base: number;
  last_cost_per_base_unit: number;
  notes?: string | null;
};

type IngredientForm = {
  name: string;
  measurement_type: MeasurementType;
  base_unit: UnitOption;
  min_stock_qty_base: string;
  notes: string;
};

type PurchaseForm = {
  ingredient_id: string;
  quantity: string;
  purchase_unit: UnitOption;
  total_cost: string;
};

// NOVO: Tipo para o item da lista do carrinho de compras
type PurchaseListItem = PurchaseForm & {
  id_temp: number;
  ingredient_name: string;
};

const unitOptionsByType: Record<MeasurementType, UnitOption[]> = {
  mass: ["mg", "g", "kg"],
  volume: ["ml", "L"],
  unit: ["un"],
};

const defaultBaseUnitByType: Record<MeasurementType, UnitOption> = {
  mass: "g",
  volume: "ml",
  unit: "un",
};

const emptyIngredientForm: IngredientForm = {
  name: "",
  measurement_type: "mass",
  base_unit: "g",
  min_stock_qty_base: "0",
  notes: "",
};

const emptyPurchaseForm: PurchaseForm = {
  ingredient_id: "",
  quantity: "",
  purchase_unit: "g",
  total_cost: "",
};

function convertToBase(quantity: number, unit: UnitOption, baseUnit: UnitOption) {
  if (!Number.isFinite(quantity)) return 0;
  const factors: Record<string, number> = { mg: 0.001, g: 1, kg: 1000, ml: 1, L: 1000, un: 1 };
  const sourceFactor = factors[unit];
  const targetFactor = factors[baseUnit];
  if (!sourceFactor || !targetFactor) return quantity;
  return (quantity * sourceFactor) / targetFactor;
}

export default function Inventory() {
  const [items, setItems] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);

  const [ingredientDialogOpen, setIngredientDialogOpen] = useState(false);
  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);

  const [ingredientForm, setIngredientForm] = useState<IngredientForm>(emptyIngredientForm);
  
  // Controle de Múltiplas Compras
  const [purchaseForm, setPurchaseForm] = useState<PurchaseForm>(emptyPurchaseForm);
  const [purchaseList, setPurchaseList] = useState<PurchaseListItem[]>([]);

  const [savingIngredient, setSavingIngredient] = useState(false);
  const [savingPurchase, setSavingPurchase] = useState(false);

  async function loadIngredients() {
    setLoading(true);
    try {
      const { data } = await api.get<Ingredient[]>("/ingredients");
      setItems(data);

      if (!purchaseForm.ingredient_id && data.length > 0) {
        const first = data[0];
        setPurchaseForm((prev) => ({
          ...prev,
          ingredient_id: String(first.id),
          purchase_unit: first.base_unit,
        }));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadIngredients();
  }, []);

  const selectedPurchaseIngredient = useMemo(
    () => items.find((i) => String(i.id) === purchaseForm.ingredient_id),
    [items, purchaseForm.ingredient_id]
  );

  const purchaseAllowedUnits = useMemo(() => {
    if (!selectedPurchaseIngredient) return ["g"] as UnitOption[];
    return unitOptionsByType[selectedPurchaseIngredient.measurement_type];
  }, [selectedPurchaseIngredient]);

  const purchasePreview = useMemo(() => {
    if (!selectedPurchaseIngredient) return { qtyBase: 0, costPerBase: 0 };
    const qty = Number(purchaseForm.quantity || 0);
    const total = Number(purchaseForm.total_cost || 0);
    const qtyBase = convertToBase(qty, purchaseForm.purchase_unit, selectedPurchaseIngredient.base_unit);
    const costPerBase = qtyBase > 0 ? total / qtyBase : 0;
    return { qtyBase, costPerBase };
  }, [purchaseForm, selectedPurchaseIngredient]);

  const totalStockValue = useMemo(() => {
    return items.reduce((acc, item) => acc + Number(item.stock_qty_base || 0) * Number(item.last_cost_per_base_unit || 0), 0);
  }, [items]);

  const criticalCount = useMemo(() => {
    return items.filter((i) => Number(i.stock_qty_base) <= Number(i.min_stock_qty_base)).length;
  }, [items]);

  // Soma o total da nota de compras sendo montada
  const totalPurchaseListValue = useMemo(() => {
    return purchaseList.reduce((acc, item) => acc + Number(item.total_cost), 0);
  }, [purchaseList]);

  function handleMeasurementTypeChange(type: MeasurementType) {
    const base = defaultBaseUnitByType[type];
    setIngredientForm((prev) => ({ ...prev, measurement_type: type, base_unit: base }));
  }

  async function handleCreateIngredient() {
    if (!ingredientForm.name.trim()) return alert("Digite o nome do insumo.");
    setSavingIngredient(true);
    try {
      await api.post("/ingredients", {
        name: ingredientForm.name.trim(),
        measurement_type: ingredientForm.measurement_type,
        base_unit: ingredientForm.base_unit,
        min_stock_qty_base: Number(ingredientForm.min_stock_qty_base || 0),
        notes: ingredientForm.notes.trim() || null,
      });
      setIngredientDialogOpen(false);
      setIngredientForm(emptyIngredientForm);
      await loadIngredients();
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao criar insumo.");
    } finally {
      setSavingIngredient(false);
    }
  }

  // ADICIONA O ITEM NA LISTA DO MODAL
  function handleAddPurchaseToList() {
    if (!purchaseForm.ingredient_id) return alert("Selecione um insumo.");
    if (!purchaseForm.quantity || Number(purchaseForm.quantity) <= 0) return alert("Digite uma quantidade válida.");
    if (!purchaseForm.total_cost || Number(purchaseForm.total_cost) <= 0) return alert("Digite o valor pago.");

    const itemToAdd: PurchaseListItem = {
      ...purchaseForm,
      id_temp: Date.now(), // ID temporário pra montar a lista no React
      ingredient_name: selectedPurchaseIngredient?.name || "Insumo",
    };

    setPurchaseList((prev) => [...prev, itemToAdd]);
    
    // Reseta os campos do formulário pra ficar pronto pro próximo item
    setPurchaseForm((prev) => ({
      ...emptyPurchaseForm,
      ingredient_id: prev.ingredient_id,
      purchase_unit: prev.purchase_unit,
    }));
  }

  // REMOVE UM ITEM DA LISTA DO MODAL
  function handleRemoveFromPurchaseList(idTemp: number) {
    setPurchaseList((prev) => prev.filter(item => item.id_temp !== idTemp));
  }

  // ENVIA A LISTA INTEIRA PRO BANCO DE DADOS
  async function handleRegisterPurchase() {
    if (purchaseList.length === 0) return alert("Adicione ao menos um item na lista de compra.");

    setSavingPurchase(true);
    try {
      // Manda a lista toda pra nossa nova rota!
      await api.post("/ingredients/purchase", {
        items: purchaseList.map(item => ({
          ingredient_id: Number(item.ingredient_id),
          quantity: Number(item.quantity),
          purchase_unit: item.purchase_unit,
          total_cost: Number(item.total_cost),
        }))
      });

      setPurchaseDialogOpen(false);
      setPurchaseList([]); // Limpa o carrinho
      await loadIngredients();
      alert("Compras registradas com sucesso!");
    } catch (err: any) {
      alert(err?.response?.data?.error || "Erro ao registrar compras.");
    } finally {
      setSavingPurchase(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estoque de Insumos"
        description="Cadastro simples + compra múltipla com cálculo automático de custo."
        actions={
          <div className="flex gap-2">
            <Dialog open={ingredientDialogOpen} onOpenChange={setIngredientDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Novo Insumo
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Novo Insumo</DialogTitle>
                </DialogHeader>

                <div className="grid gap-3 py-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Nome do insumo</label>
                    <Input
                      value={ingredientForm.name}
                      onChange={(e) => setIngredientForm((s) => ({ ...s, name: e.target.value }))}
                      placeholder="Ex: Farinha de trigo"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium">Tipo de medida</label>
                      <select
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                        value={ingredientForm.measurement_type}
                        onChange={(e) => handleMeasurementTypeChange(e.target.value as MeasurementType)}
                      >
                        <option value="mass">Massa</option>
                        <option value="volume">Volume</option>
                        <option value="unit">Unidade</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium">Unidade base</label>
                      <select
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                        value={ingredientForm.base_unit}
                        onChange={(e) => setIngredientForm((s) => ({ ...s, base_unit: e.target.value as UnitOption }))}
                      >
                        {unitOptionsByType[ingredientForm.measurement_type].map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Estoque mínimo ({ingredientForm.base_unit})
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      value={ingredientForm.min_stock_qty_base}
                      onChange={(e) => setIngredientForm((s) => ({ ...s, min_stock_qty_base: e.target.value }))}
                      placeholder="Ex: 500"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium">Observação (opcional)</label>
                    <textarea
                      className="min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={ingredientForm.notes}
                      onChange={(e) => setIngredientForm((s) => ({ ...s, notes: e.target.value }))}
                      placeholder="Marca padrão, fornecedor, detalhes..."
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setIngredientDialogOpen(false)} disabled={savingIngredient}>
                      Cancelar
                    </Button>
                    <Button onClick={handleCreateIngredient} disabled={savingIngredient}>
                      {savingIngredient ? "Salvando..." : "Salvar insumo"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={purchaseDialogOpen} onOpenChange={setPurchaseDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="border-green-600 text-green-700 hover:bg-green-50">
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  Lançar Compras
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Lançar Compras (Múltiplos Itens)</DialogTitle>
                </DialogHeader>

                <div className="grid gap-4 py-2">
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <p className="text-sm font-semibold mb-3">1. Adicionar item à nota</p>
                    <div className="grid md:grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium">Insumo</label>
                        <select
                          className="h-8 w-full rounded-md border bg-background px-3 text-sm"
                          value={purchaseForm.ingredient_id}
                          onChange={(e) => {
                            const selected = items.find((i) => String(i.id) === e.target.value);
                            setPurchaseForm((s) => ({ ...s, ingredient_id: e.target.value, purchase_unit: selected?.base_unit || "g" }));
                          }}
                        >
                          <option value="">Selecione...</option>
                          {items.map((item) => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-xs font-medium">Quantidade</label>
                          <Input
                            type="number"
                            step="0.01"
                            className="h-8"
                            value={purchaseForm.quantity}
                            onChange={(e) => setPurchaseForm((s) => ({ ...s, quantity: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium">Unid. Compra</label>
                          <select
                            className="h-8 w-full rounded-md border bg-background px-3 text-sm"
                            value={purchaseForm.purchase_unit}
                            onChange={(e) => setPurchaseForm((s) => ({ ...s, purchase_unit: e.target.value as UnitOption }))}
                          >
                            {purchaseAllowedUnits.map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-end gap-3">
                      <div className="w-full">
                        <label className="mb-1 block text-xs font-medium">Valor pago (R$)</label>
                        <Input
                          type="number"
                          step="0.01"
                          className="h-8"
                          value={purchaseForm.total_cost}
                          onChange={(e) => setPurchaseForm((s) => ({ ...s, total_cost: e.target.value }))}
                        />
                      </div>
                      <Button onClick={handleAddPurchaseToList} className="h-8 shrink-0 bg-blue-600 hover:bg-blue-700">
                        <Plus className="mr-1 h-4 w-4" /> Incluir
                      </Button>
                    </div>

                    {selectedPurchaseIngredient && purchaseForm.quantity && purchaseForm.total_cost ? (
                      <p className="text-xs text-muted-foreground mt-2">
                        O sistema irá calcular o custo de <strong>{formatCurrency(purchasePreview.costPerBase)} / {selectedPurchaseIngredient.base_unit}</strong> e adicionar <strong>{formatNumber(purchasePreview.qtyBase)}{selectedPurchaseIngredient.base_unit}</strong> ao estoque.
                      </p>
                    ) : null}
                  </div>

                  {/* LISTA DE ITENS ADICIONADOS */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-sm font-semibold">2. Lista de Itens ({purchaseList.length})</p>
                      <p className="text-sm font-bold text-primary">Total: {formatCurrency(totalPurchaseListValue)}</p>
                    </div>
                    
                    {purchaseList.length === 0 ? (
                      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                        Nenhum item adicionado ainda.
                      </div>
                    ) : (
                      <div className="space-y-2 border rounded-lg p-2 max-h-[250px] overflow-y-auto">
                        {purchaseList.map((item) => (
                          <div key={item.id_temp} className="flex items-center justify-between bg-muted/30 p-2 rounded-md border text-sm">
                            <div>
                              <p className="font-semibold">{item.ingredient_name}</p>
                              <p className="text-xs text-muted-foreground">{item.quantity} {item.purchase_unit}</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-medium">{formatCurrency(Number(item.total_cost))}</span>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => handleRemoveFromPurchaseList(item.id_temp)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button
                      variant="outline"
                      onClick={() => setPurchaseDialogOpen(false)}
                      disabled={savingPurchase}
                    >
                      Cancelar
                    </Button>
                    <Button 
                      className="bg-green-600 hover:bg-green-700" 
                      onClick={handleRegisterPurchase} 
                      disabled={savingPurchase || purchaseList.length === 0}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      {savingPurchase ? "Salvando..." : "Salvar Nota Completa"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total de insumos</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{items.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Estoque crítico</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{criticalCount}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Valor estimado em estoque</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatCurrency(totalStockValue)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lista de Insumos</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum insumo cadastrado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Insumo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estoque Atual</TableHead>
                  <TableHead>Mínimo</TableHead>
                  <TableHead>Último custo</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const critical =
                    Number(item.stock_qty_base || 0) <= Number(item.min_stock_qty_base || 0);

                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>
                        {item.measurement_type === "mass"
                          ? "Massa"
                          : item.measurement_type === "volume"
                          ? "Volume"
                          : "Unidade"}
                      </TableCell>
                      <TableCell>
                        {formatNumber(item.stock_qty_base)} {item.base_unit}
                      </TableCell>
                      <TableCell>
                        {formatNumber(item.min_stock_qty_base)} {item.base_unit}
                      </TableCell>
                      <TableCell>
                        {formatCurrency(item.last_cost_per_base_unit)} / {item.base_unit}
                      </TableCell>
                      <TableCell>
                        {critical ? (
                          <Badge variant="destructive">Crítico</Badge>
                        ) : (
                          <Badge variant="secondary">OK</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}