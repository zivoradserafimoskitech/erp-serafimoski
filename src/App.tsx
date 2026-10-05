import { Routes, Route } from "react-router";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Storage from "@/pages/Storage";
import Production from "@/pages/Production";
import Customers from "@/pages/Customers";
import Procurement from "@/pages/Procurement";
import Accounting from "@/pages/Accounting";
import Quotations from "@/pages/Quotations";
import Receipts from "@/pages/Receipts";
import SettingsPage from "@/pages/Settings";
import CatalogPage from "@/pages/Catalog";
import NotFound from "@/pages/NotFound";
import RemnantScan from "@/pages/RemnantScan";
import WorkOrderScan from "@/pages/WorkOrderScan";
import Assets from "@/pages/Assets";
import Finance from "@/pages/Finance";
import Quality from "@/pages/Quality";
import Employees from "@/pages/Employees";
import DealPipeline from "@/pages/DealPipeline";
import Crm from "@/pages/Crm";
import Reports from "@/pages/Reports";
import DeliveryNotes from "@/pages/DeliveryNotes";
import Portal from "@/pages/Portal";
import SalesHub from "@/pages/SalesHub";
import PriceLists from "@/pages/PriceLists";

export default function App() {
  return (
    <Routes>
      {/* Скенирање на етикета — без Layout, за телефон */}
      <Route path="/o/:code" element={<RemnantScan />} />
      <Route path="/n/:id" element={<WorkOrderScan />} />
      {/* Портал за клиенти — таен линк, без најава и без менито */}
      <Route path="/portal/:token" element={<Portal />} />
      <Route path="/prodazba" element={<Layout><SalesHub /></Layout>} />
      <Route path="/cenovnici" element={<Layout><PriceLists /></Layout>} />
      <Route path="/crm" element={<Layout><Crm /></Layout>} />
      <Route path="/izvestai" element={<Layout><Reports /></Layout>} />
      <Route
        path="/"
        element={
          <Layout>
            <Dashboard />
          </Layout>
        }
      />
      <Route
        path="/sklad"
        element={
          <Layout>
            <Storage />
          </Layout>
        }
      />
      <Route
        path="/proizvodstvo"
        element={
          <Layout>
            <Production />
          </Layout>
        }
      />
      <Route
        path="/klienti"
        element={
          <Layout>
            <Customers />
          </Layout>
        }
      />
      <Route
        path="/nabavka"
        element={
          <Layout>
            <Procurement />
          </Layout>
        }
      />
      <Route
        path="/smetkovodstvo"
        element={
          <Layout>
            <Accounting />
          </Layout>
        }
      />
      <Route
        path="/ispratnici"
        element={
          <Layout>
            <DeliveryNotes />
          </Layout>
        }
      />
      <Route
        path="/ponudi"
        element={
          <Layout>
            <Quotations />
          </Layout>
        }
      />
      <Route
        path="/priemnici"
        element={
          <Layout>
            <Receipts />
          </Layout>
        }
      />
      <Route
        path="/podesuvanja"
        element={
          <Layout>
            <SettingsPage />
          </Layout>
        }
      />
      <Route
        path="/katalog"
        element={
          <Layout>
            <CatalogPage />
          </Layout>
        }
      />
      <Route
        path="/sredstva"
        element={
          <Layout>
            <Assets />
          </Layout>
        }
      />
      <Route
        path="/finansii"
        element={
          <Layout>
            <Finance />
          </Layout>
        }
      />
      <Route
        path="/kvalitet"
        element={
          <Layout>
            <Quality />
          </Layout>
        }
      />
      <Route
        path="/vraboteni"
        element={
          <Layout>
            <Employees />
          </Layout>
        }
      />
      <Route
        path="/tek"
        element={
          <Layout>
            <DealPipeline />
          </Layout>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
