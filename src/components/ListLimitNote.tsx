/** Напомена кога листата ги прикажува само најновите записи (серверот враќа најмногу 500 без пребарување). */
export default function ListLimitNote({ count, limit = 500 }: { count?: number; limit?: number }) {
  if (!count || count < limit) return null;
  return (
    <p className="text-xs text-gray-500 px-4 py-2 border-t bg-gray-50">
      Прикажани се последните {limit}. За постари записи користи пребарување или филтер.
    </p>
  );
}
