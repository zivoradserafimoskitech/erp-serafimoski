import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";

// Ставки на фактура (излезна/влезна) — избор на производ, услуга или материјал
export default function InvoiceItemForm({
  products,
  services,
  finishedGoods,
  onAdd,
}: {
  products?: Array<{ id: number; name: string; code: string; unit: string; price: string | null; category: string }>;
  services?: Array<{ id: number; name: string; code: string; unit: string; price: string | null; type: string }>;
  finishedGoods?: Array<{ id: number; productId: number; quantity: string | null; unitCost: string | null }>;
  onAdd: (item: any) => void;
}) {
  const [itemType, setItemType] = useState<"product" | "service" | "manual">("manual");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("ком");
  const [unitPrice, setUnitPrice] = useState("");
  const [vatRate, setVatRate] = useState("18");

  const getStockForProduct = (productId: number) => {
    if (!finishedGoods) return 0;
    return finishedGoods
      .filter(fg => fg.productId === productId)
      .reduce((sum, fg) => sum + parseFloat(String(fg.quantity || "0")), 0);
  };

  const handleAdd = () => {
    let finalDescription = description;
    let finalUnitPrice = unitPrice;
    let finalUnit = unit;
    let productId: number | undefined;
    let serviceId: number | undefined;

    if (itemType === "product" && selectedProductId) {
      const product = products?.find(p => p.id.toString() === selectedProductId);
      if (!product) return;
      productId = product.id;
      finalDescription = product.name;
      finalUnit = product.unit || "ком";
      if (!unitPrice) finalUnitPrice = product.price || "0";

      // Check stock
      const stock = getStockForProduct(product.id);
      if (stock < parseFloat(quantity || "0")) {
        alert(`Нема доволно залиха! На залиха: ${stock.toFixed(2)}, побарано: ${parseFloat(quantity || "0").toFixed(2)}`);
        return;
      }
    } else if (itemType === "service" && selectedServiceId) {
      const service = services?.find(s => s.id.toString() === selectedServiceId);
      if (!service) return;
      serviceId = service.id;
      finalDescription = service.name;
      finalUnit = service.unit || "час";
      if (!unitPrice) finalUnitPrice = service.price || "0";
    }

    const qty = parseFloat(quantity || "0");
    const price = parseFloat(finalUnitPrice || "0");
    const total = qty * price;

    onAdd({
      description: finalDescription,
      quantity: quantity,
      unit: finalUnit,
      unitPrice: finalUnitPrice || "0",
      discount: "0",
      totalPrice: total.toFixed(2),
      vatRate: vatRate,
      notes: "",
      productId,
      serviceId,
      itemType,
    });

    // Reset form
    setSelectedProductId("");
    setSelectedServiceId("");
    setDescription("");
    setQuantity("1");
    setUnitPrice("");
  };

  return (
    <div className="space-y-2">
      {/* Item Type Selector */}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={itemType === "product" ? "default" : "outline"}
          onClick={() => setItemType("product")}
          className={itemType === "product" ? "bg-blue-500" : ""}
        >
          Производ (склад)
        </Button>
        <Button
          type="button"
          size="sm"
          variant={itemType === "service" ? "default" : "outline"}
          onClick={() => setItemType("service")}
          className={itemType === "service" ? "bg-purple-500" : ""}
        >
          Услуга
        </Button>
        <Button
          type="button"
          size="sm"
          variant={itemType === "manual" ? "default" : "outline"}
          onClick={() => setItemType("manual")}
          className={itemType === "manual" ? "bg-gray-500" : ""}
        >
          Рачен опис
        </Button>
      </div>

      {/* Product Selector */}
      {itemType === "product" && (
        <div className="space-y-2">
          <Select value={selectedProductId} onValueChange={(v) => {
            setSelectedProductId(v);
            const product = products?.find(p => p.id.toString() === v);
            if (product) {
              setDescription(product.name);
              setUnit(product.unit || "ком");
              setUnitPrice(product.price || "");
            }
          }}>
            <SelectTrigger><SelectValue placeholder="Избери производ..." /></SelectTrigger>
            <SelectContent>
              {products?.map(p => {
                const stock = getStockForProduct(p.id);
                return (
                  <SelectItem key={p.id} value={p.id.toString()}>
                    {p.name} ({p.code}) - {stock.toFixed(2)} {p.unit} на залиха
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {selectedProductId && (
            <p className="text-xs text-blue-600">
              На залиха: {getStockForProduct(parseInt(selectedProductId)).toFixed(2)} {unit}
            </p>
          )}
        </div>
      )}

      {/* Service Selector */}
      {itemType === "service" && (
        <div className="space-y-2">
          <Select value={selectedServiceId} onValueChange={(v) => {
            setSelectedServiceId(v);
            const service = services?.find(s => s.id.toString() === v);
            if (service) {
              setDescription(service.name);
              setUnit(service.unit || "час");
              setUnitPrice(service.price || "");
            }
          }}>
            <SelectTrigger><SelectValue placeholder="Избери услуга..." /></SelectTrigger>
            <SelectContent>
              {services?.map(s => (
                <SelectItem key={s.id} value={s.id.toString()}>
                  {s.name} ({s.code}) - {s.price ?? "?"} ден./{s.unit}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Manual Description */}
      {itemType === "manual" && (
        <Input placeholder="Опис на ставка" value={description} onChange={e => setDescription(e.target.value)} />
      )}

      {/* Quantity & Price */}
      <div className="grid grid-cols-4 gap-2">
        <Input type="number" placeholder="Количина" value={quantity} onChange={e => setQuantity(e.target.value)} />
        <Input placeholder="Единица" value={unit} onChange={e => setUnit(e.target.value)} />
        <Input type="number" placeholder="Цена" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} />
        <Select value={vatRate} onValueChange={setVatRate}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="18">18% ДДВ</SelectItem>
            <SelectItem value="5">5% ДДВ</SelectItem>
            <SelectItem value="0">0% ДДВ</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button type="button" size="sm" variant="outline" onClick={handleAdd} disabled={!description || !quantity || !unitPrice}>
        <Plus className="h-3 w-3 mr-1" /> Додади ставка
      </Button>
    </div>
  );
}

// ===== UJP E-FAKTURA TAB COMPONENT =====
