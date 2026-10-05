import { useEffect } from "react";
import { useSearchParams } from "react-router";
import Accounting from "@/pages/Accounting";
import PageHeader from "@/components/layout/PageHeader";
import { Truck } from "lucide-react";
import { Link } from "react-router";

/**
 * Испратници како посебна точка во менито.
 * Ја користи истата логика како табот „Испратници“ во Фактури (без дуплирање на API).
 */
export default function DeliveryNotes() {
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("tab") !== "delivery") {
      const next = new URLSearchParams(params);
      next.set("tab", "delivery");
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Испратници"
        description="Испорака кон клиенти — создавање, печат и атести. Фактурите се во"
        icon={<Truck className="h-6 w-6 text-primary" />}
        actions={
          <Link to="/smetkovodstvo" className="text-sm text-primary hover:underline">
            Фактури →
          </Link>
        }
      />
      <Accounting embedTab="delivery" />
    </div>
  );
}
