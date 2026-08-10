// Правила за залихи — заеднички за сервер и екран.

/**
 * Материјалот е „под минимум" само ако воопшто е поставен минимум.
 * Без ова, секој материјал што уште не е примен (0 залиха, 0 минимум)
 * се брои како недостиг и бројката станува бесмислена.
 */
export function isLowStock(m: { currentStock: any; minStock: any }): boolean {
  const min = parseFloat(String(m.minStock ?? "0")) || 0;
  if (min <= 0) return false;
  const cur = parseFloat(String(m.currentStock ?? "0")) || 0;
  return cur <= min;
}
