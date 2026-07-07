import { relations } from "drizzle-orm";
import {
  materials,
  inventoryTransactions,
  customers,
  orders,
  orderItems,
  suppliers,
  purchaseOrders,
  purchaseOrderItems,
  workOrders,
  workOrderOperations,
} from "./schema";

export const materialsRelations = relations(materials, ({ many }) => ({
  transactions: many(inventoryTransactions),
  purchaseOrderItems: many(purchaseOrderItems),
}));

export const inventoryTransactionsRelations = relations(inventoryTransactions, ({ one }) => ({
  material: one(materials, {
    fields: [inventoryTransactions.materialId],
    references: [materials.id],
  }),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  items: many(orderItems),
  workOrders: many(workOrders),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
}));

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  purchaseOrders: many(purchaseOrders),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  supplier: one(suppliers, {
    fields: [purchaseOrders.supplierId],
    references: [suppliers.id],
  }),
  items: many(purchaseOrderItems),
}));

export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderItems.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  material: one(materials, {
    fields: [purchaseOrderItems.materialId],
    references: [materials.id],
  }),
}));

export const workOrdersRelations = relations(workOrders, ({ one, many }) => ({
  order: one(orders, {
    fields: [workOrders.orderId],
    references: [orders.id],
  }),
  operations: many(workOrderOperations),
}));

export const workOrderOperationsRelations = relations(workOrderOperations, ({ one }) => ({
  workOrder: one(workOrders, {
    fields: [workOrderOperations.workOrderId],
    references: [workOrders.id],
  }),
}));
