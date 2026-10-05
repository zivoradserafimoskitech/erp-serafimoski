import type { ReactNode } from "react";
export default function PageHeader({ title, description, icon, actions }: { title: string; description?: string; icon?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">{icon}<span className="truncate">{title}</span></h2>
        {description ? <p className="text-gray-500 mt-1 text-sm sm:text-base">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}
