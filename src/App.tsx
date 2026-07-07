import { Routes, Route } from "react-router";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Storage from "@/pages/Storage";
import Production from "@/pages/Production";
import Customers from "@/pages/Customers";
import Procurement from "@/pages/Procurement";
import Accounting from "@/pages/Accounting";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
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
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
