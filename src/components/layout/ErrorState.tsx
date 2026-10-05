import { Button } from "@/components/ui/button";

export default function ErrorState({
  message = "Нешто не успеа",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="py-12 px-4 text-center space-y-3">
      <p className="text-sm text-red-600 font-medium">{message}</p>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Обиди се повторно
        </Button>
      ) : null}
    </div>
  );
}
