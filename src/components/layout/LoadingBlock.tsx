export default function LoadingBlock({ label = "Вчитување..." }: { label?: string }) {
  return (
    <div className="py-12 flex flex-col items-center justify-center gap-3 text-sm text-gray-400">
      <div className="h-8 w-8 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" aria-hidden />
      <p>{label}</p>
    </div>
  );
}
