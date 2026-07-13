import { getDb } from "../api/queries/connection";
import { warehouses, units, companySettings } from "./schema";

async function seedDefaults() {
  const db = getDb();

  // 1. Create default warehouse if none exist
  const whCount = await db.select().from(warehouses);
  if (whCount.length === 0) {
    await db.insert(warehouses).values([
      { code: "GL-MAT", name: "Главен Магацин - Материјали", type: "raw_materials", address: "Скопје", isActive: "active" },
      { code: "GL-PROD", name: "Главен Магацин - Производи", type: "finished_goods", address: "Скопје", isActive: "active" },
    ]);
    console.log("Created 2 default warehouses");
  } else {
    console.log(`Warehouses already exist: ${whCount.length}`);
  }

  // 2. Create default units if none exist
  const unitCount = await db.select().from(units);
  if (unitCount.length === 0) {
    await db.insert(units).values([
      { code: "kg", name: "Килограм", nameMk: "Килограм", category: "weight", isActive: "active" },
      { code: "m", name: "Метар", nameMk: "Метар", category: "length", isActive: "active" },
      { code: "m2", name: "Квадратен метар", nameMk: "Квадратен метар", category: "area", isActive: "active" },
      { code: "kom", name: "Комад", nameMk: "Комад", category: "piece", isActive: "active" },
      { code: "l", name: "Литар", nameMk: "Литар", category: "volume", isActive: "active" },
      { code: "h", name: "Час", nameMk: "Час", category: "time", isActive: "active" },
    ]);
    console.log("Created 6 default units");
  } else {
    console.log(`Units already exist: ${unitCount.length}`);
  }

  // 3. Create default company settings if none exist
  const csCount = await db.select().from(companySettings);
  if (csCount.length === 0) {
    await db.insert(companySettings).values({
      name: "Серафимоски Тек",
      address: "Скопје, Македонија",
      edb: "1234567890123",
      embs: "987654321",
      bankName: "Комерцијална Банка",
      bankAccount: "300000000012345",
      phone: "02/123-456",
      email: "info@serafimoski.mk",
      defaultVatRate: "18",
      valuationMethod: "weighted_average",
      currency: "MKD",
      timezone: "Europe/Skopje",
    });
    console.log("Created default company settings for Serafimoski Tek");
  } else {
    console.log("Company settings already exist");
  }

  console.log("Default seed complete!");
  process.exit(0);
}

seedDefaults().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
