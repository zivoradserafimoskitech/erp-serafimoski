import { authRouter } from "./auth-router";
import { storageRouter } from "./storage-router";
import { productionRouter } from "./production-router";
import { customersRouter } from "./customers-router";
import { procurementRouter } from "./procurement-router";
import { dashboardRouter } from "./dashboard-router";
import { accountingRouter } from "./accounting-router";
import { quotationRouter } from "./quotation-router";
import { settingsRouter } from "./settings-router";
import { warehouseRouter } from "./warehouse-router";
import { catalogRouter } from "./catalog-router";
import { ocrRouter } from "./ocr-router";
import { emailRouter } from "./email-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  storage: storageRouter,
  production: productionRouter,
  customers: customersRouter,
  procurement: procurementRouter,
  dashboard: dashboardRouter,
  accounting: accountingRouter,
  quotation: quotationRouter,
  settings: settingsRouter,
  warehouse: warehouseRouter,
  catalog: catalogRouter,
  ocr: ocrRouter,
  email: emailRouter,
});

export type AppRouter = typeof appRouter;
