import type { ReactNode } from "react";

export default function EmptyState({
  title = "Нема податоци",
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="py-12 px-4 text-center">
      <p className="text-sm font-medium text-gray-600">{title}</p>
      {description ? <p className="text-sm text-gray-400 mt-1 max-w-md mx-auto">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
