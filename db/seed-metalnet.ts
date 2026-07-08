import { getDb } from "../api/queries/connection";
import { suppliers, materials } from "./schema";

async function seedMetalNet() {
  const db = getDb();

  // 1. Create supplier "Metal Net"
  const existing = await db.select().from(suppliers).where(eq(suppliers.name, "Метал Нет"));
  let supplierId: number;
  
  if (existing.length === 0) {
    const result = await db.insert(suppliers).values({
      name: "Метал Нет",
      edb: "",
      address: "Ул. 11ти Октомври бб, Гази Баба, Скопје",
      city: "Скопје",
      country: "Македонија",
      paymentTerms: "30 дена",
      defaultCurrency: "MKD",
      isActive: "active",
    });
    supplierId = Number(result[0].insertId);
    console.log("Created supplier Metal Net with ID:", supplierId);
  } else {
    supplierId = existing[0].id;
    console.log("Supplier Metal Net already exists with ID:", supplierId);
  }

  // 2. Import materials from price list
  // Prices include 18% VAT, so we divide by 1.18 to get net price
  const vatFactor = 1.18;

  const metalNetMaterials = [
    // Поцинкована жица
    { name: "Поцинкована жица ф1.8", code: "PNZ-001", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (75 / vatFactor).toFixed(2), description: "Поцинкована жица ф1.8 - Метал Нет" },
    { name: "Поцинкована жица ф1.9", code: "PNZ-002", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (75 / vatFactor).toFixed(2), description: "Поцинкована жица ф1.9 - Метал Нет" },
    { name: "Поцинкована жица ф2.2", code: "PNZ-003", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (75 / vatFactor).toFixed(2), description: "Поцинкована жица ф2.2 - Метал Нет" },
    { name: "Поцинкована жица ф2.4", code: "PNZ-004", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (75 / vatFactor).toFixed(2), description: "Поцинкована жица ф2.4 - Метал Нет" },
    { name: "Поцинкована жица ф2.5", code: "PNZ-005", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (75 / vatFactor).toFixed(2), description: "Поцинкована жица ф2.5 - Метал Нет" },
    { name: "Поцинкована жица ф3", code: "PNZ-006", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (75 / vatFactor).toFixed(2), description: "Поцинкована жица ф3 - Метал Нет" },
    { name: "Поцинкована жица ф4", code: "PNZ-007", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (75 / vatFactor).toFixed(2), description: "Поцинкована жица ф4 - Метал Нет" },
    
    // Универзална мрежа
    { name: "Универзална мрежа 1.8мм", code: "UM-001", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (75 / vatFactor).toFixed(2), description: "Универзална мрежа 1.8мм - Метал Нет" },
    { name: "Универзална мрежа 2.0мм", code: "UM-002", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (80 / vatFactor).toFixed(2), description: "Универзална мрежа 2.0мм - Метал Нет" },
    { name: "Универзална мрежа 2.2мм", code: "UM-003", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (75 / vatFactor).toFixed(2), description: "Универзална мрежа 2.2мм - Метал Нет" },
    { name: "Универзална мрежа 2.5мм", code: "UM-004", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (90 / vatFactor).toFixed(2), description: "Универзална мрежа 2.5мм - Метал Нет" },
    
    // Бигована мрежа
    { name: "Бигована мрежа 20x20", code: "BM-001", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (105 / vatFactor).toFixed(2), description: "Бигована мрежа 20x20 - Метал Нет" },
    { name: "Бигована мрежа 30x30", code: "BM-002", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (87 / vatFactor).toFixed(2), description: "Бигована мрежа 30x30 - Метал Нет" },
    { name: "Бигована мрежа 50x30", code: "BM-003", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (87 / vatFactor).toFixed(2), description: "Бигована мрежа 50x30 - Метал Нет" },
    { name: "Бигована мрежа 50x50", code: "BM-004", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (1200 / vatFactor).toFixed(2), description: "Бигована мрежа 50x50 - Метал Нет" },
    { name: "Бигована мрежа 50x70", code: "BM-005", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (690 / vatFactor).toFixed(2), description: "Бигована мрежа 50x70 - Метал Нет" },
    
    // Истегнат метал
    { name: "Истегнат метал 70x30", code: "IM-001", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (800 / vatFactor).toFixed(2), description: "Истегнат метал 70x30 - Метал Нет" },
    { name: "Истегнат метал 140x50", code: "IM-002", type: "other" as const, unit: "kg" as const, lastPurchasePrice: (650 / vatFactor).toFixed(2), description: "Истегнат метал 140x50 - Метал Нет" },
    { name: "Истегнат метал 1.5x1000x2000 (50x20)", code: "IM-003", type: "steel_sheet" as const, unit: "kg" as const, lastPurchasePrice: (600 / vatFactor).toFixed(2), description: "Истегнат метал 1.5x1000x2000 - Метал Нет" },
    { name: "Истегнат метал 2.0x1000x2000 (50x20)", code: "IM-004", type: "steel_sheet" as const, unit: "kg" as const, lastPurchasePrice: (1000 / vatFactor).toFixed(2), description: "Истегнат метал 2.0x1000x2000 - Метал Нет" },
    { name: "Истегнат метал 2.5x1000x2000 (50x20)", code: "IM-005", type: "steel_sheet" as const, unit: "kg" as const, lastPurchasePrice: (900 / vatFactor).toFixed(2), description: "Истегнат метал 2.5x1000x2000 - Метал Нет" },
    { name: "Истегнат метал 3.0x1000x2000 (50x20)", code: "IM-006", type: "steel_sheet" as const, unit: "kg" as const, lastPurchasePrice: (800 / vatFactor).toFixed(2), description: "Истегнат метал 3.0x1000x2000 - Метал Нет" },
    
    // Винкла
    { name: "Винкла 20x20x2.5", code: "VK-0202025", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (40 / vatFactor).toFixed(2), description: "Винкла 20x20x2.5 - Метал Нет" },
    { name: "Винкла 20x20x3", code: "VK-0202030", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (50 / vatFactor).toFixed(2), description: "Винкла 20x20x3 - Метал Нет" },
    { name: "Винкла 25x25x2.5", code: "VK-0252525", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (53.33 / vatFactor).toFixed(2), description: "Винкла 25x25x2.5 - Метал Нет" },
    { name: "Винкла 25x25x3", code: "VK-0252530", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (65 / vatFactor).toFixed(2), description: "Винкла 25x25x3 - Метал Нет" },
    { name: "Винкла 30x30x2.5", code: "VK-0303025", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (63.33 / vatFactor).toFixed(2), description: "Винкла 30x30x2.5 - Метал Нет" },
    { name: "Винкла 30x30x3", code: "VK-0303030", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (78.33 / vatFactor).toFixed(2), description: "Винкла 30x30x3 - Метал Нет" },
    { name: "Винкла 30x30x4", code: "VK-0303040", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (96.67 / vatFactor).toFixed(2), description: "Винкла 30x30x4 - Метал Нет" },
    { name: "Винкла 40x40x3", code: "VK-0404030", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (101.67 / vatFactor).toFixed(2), description: "Винкла 40x40x3 - Метал Нет" },
    { name: "Винкла 40x40x4", code: "VK-0404040", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (133.33 / vatFactor).toFixed(2), description: "Винкла 40x40x4 - Метал Нет" },
    { name: "Винкла 50x50x4", code: "VK-0505040", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (165 / vatFactor).toFixed(2), description: "Винкла 50x50x4 - Метал Нет" },
    { name: "Винкла 50x50x5", code: "VK-0505050", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (203.33 / vatFactor).toFixed(2), description: "Винкла 50x50x5 - Метал Нет" },
    { name: "Винкла 60x60x5", code: "VK-0606050", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (265 / vatFactor).toFixed(2), description: "Винкла 60x60x5 - Метал Нет" },
    { name: "Винкла 60x60x6", code: "VK-0606060", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (300 / vatFactor).toFixed(2), description: "Винкла 60x60x6 - Метал Нет" },
    
    // Квадратно железо
    { name: "Квадратно железо 6x6", code: "KZ-006", type: "steel_bar" as const, unit: "kg" as const, lastPurchasePrice: (16 / vatFactor).toFixed(2), description: "Квадратно железо 6x6 - Метал Нет" },
    { name: "Квадратно железо 8x8", code: "KZ-008", type: "steel_bar" as const, unit: "kg" as const, lastPurchasePrice: (32.50 / vatFactor).toFixed(2), description: "Квадратно железо 8x8 - Метал Нет" },
    { name: "Квадратно железо 10x10", code: "KZ-010", type: "steel_bar" as const, unit: "kg" as const, lastPurchasePrice: (45 / vatFactor).toFixed(2), description: "Квадратно железо 10x10 - Метал Нет" },
    { name: "Квадратно железо 12x12", code: "KZ-012", type: "steel_bar" as const, unit: "kg" as const, lastPurchasePrice: (58.33 / vatFactor).toFixed(2), description: "Квадратно железо 12x12 - Метал Нет" },
    { name: "Квадратно железо 14x14", code: "KZ-014", type: "steel_bar" as const, unit: "kg" as const, lastPurchasePrice: (81.67 / vatFactor).toFixed(2), description: "Квадратно железо 14x14 - Метал Нет" },
    { name: "Квадратно железо 16x16", code: "KZ-016", type: "steel_bar" as const, unit: "kg" as const, lastPurchasePrice: (108.33 / vatFactor).toFixed(2), description: "Квадратно железо 16x16 - Метал Нет" },
    
    // Арматура
    { name: "Арматура железо ф6", code: "AR-006", type: "steel_bar" as const, unit: "kg" as const, lastPurchasePrice: (24 / vatFactor).toFixed(2), description: "Арматура железо ф6 - Метал Нет" },
    { name: "Арматура железо ф8", code: "AR-008", type: "steel_bar" as const, unit: "kg" as const, lastPurchasePrice: (30 / vatFactor).toFixed(2), description: "Арматура железо ф8 - Метал Нет" },
    { name: "Арматура железо ф10", code: "AR-010", type: "steel_bar" as const, unit: "kg" as const, lastPurchasePrice: (44.17 / vatFactor).toFixed(2), description: "Арматура железо ф10 - Метал Нет" },
    { name: "Арматура железо ф12", code: "AR-012", type: "steel_bar" as const, unit: "kg" as const, lastPurchasePrice: (60 / vatFactor).toFixed(2), description: "Арматура железо ф12 - Метал Нет" },
    { name: "Арматура железо ф14", code: "AR-014", type: "steel_bar" as const, unit: "kg" as const, lastPurchasePrice: (81.67 / vatFactor).toFixed(2), description: "Арматура железо ф14 - Метал Нет" },
    { name: "Арматура железо ф16", code: "AR-016", type: "steel_bar" as const, unit: "kg" as const, lastPurchasePrice: (110 / vatFactor).toFixed(2), description: "Арматура железо ф16 - Метал Нет" },
    { name: "Арматура железо ф18", code: "AR-018", type: "steel_bar" as const, unit: "kg" as const, lastPurchasePrice: (131.67 / vatFactor).toFixed(2), description: "Арматура железо ф18 - Метал Нет" },
    { name: "Арматура железо ф20", code: "AR-020", type: "steel_bar" as const, unit: "kg" as const, lastPurchasePrice: (165 / vatFactor).toFixed(2), description: "Арматура железо ф20 - Метал Нет" },
    { name: "Арматура железо ф22", code: "AR-022", type: "steel_bar" as const, unit: "kg" as const, lastPurchasePrice: (241.67 / vatFactor).toFixed(2), description: "Арматура железо ф22 - Метал Нет" },
    { name: "Арматура железо ф25", code: "AR-025", type: "steel_bar" as const, unit: "kg" as const, lastPurchasePrice: (283.33 / vatFactor).toFixed(2), description: "Арматура железо ф25 - Метал Нет" },
    
    // Квадратен профил
    { name: "Квадратен профил 12x12x1.2", code: "KP-1212", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (33.33 / vatFactor).toFixed(2), description: "Квадратен профил 12x12x1.2 - Метал Нет" },
    { name: "Квадратен профил 12x12x1.5", code: "KP-1215", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (36.67 / vatFactor).toFixed(2), description: "Квадратен профил 12x12x1.5 - Метал Нет" },
    { name: "Квадратен профил 15x15x1.2", code: "KP-1512", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (31.67 / vatFactor).toFixed(2), description: "Квадратен профил 15x15x1.2 - Метал Нет" },
    { name: "Квадратен профил 15x15x1.5", code: "KP-1515", type: "steel_profile" as const, unit: "kg" as const, lastPurchasePrice: (37.50 / vatFactor).toFixed(2), description: "Квадратен профил 15x15x1.5 - Метал Нет" },
  ];

  let inserted = 0;
  let skipped = 0;

  for (const mat of metalNetMaterials) {
    // Check if material with same code already exists
    const existing = await db.select().from(materials).where(eq(materials.code, mat.code));
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    
    await db.insert(materials).values({
      ...mat,
      currentStock: "0",
      avgCost: mat.lastPurchasePrice,
      minStock: "0",
      isActive: "active",
    });
    inserted++;
  }

  console.log(`Import complete: ${inserted} materials inserted, ${skipped} skipped (already existed)`);
  process.exit(0);
}

// Need to import eq
import { eq } from "drizzle-orm";

seedMetalNet().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
