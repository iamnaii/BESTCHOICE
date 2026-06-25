/** Clamped next/prev index for keyboard room nav (no wrap-around). */
export function nextRoomIndex(currentIndex: number, direction: 1 | -1, length: number): number {
  if (length === 0) return -1;
  if (currentIndex < 0) return direction === 1 ? 0 : length - 1;
  return Math.max(0, Math.min(length - 1, currentIndex + direction));
}
