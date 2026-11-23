import type { BuybackCatalog } from '@/types/buyback';
export type SeriesGroup = { id: string; label: string; models: BuybackCatalog['models'] };
export function groupModels(models: BuybackCatalog['models']): SeriesGroup[] {
  const groups = new Map<string, SeriesGroup>();
  for (const item of models) {
    const id =
      item.model.match(/^iPhone\s+(\d+)/i)?.[1] ??
      (/^iPhone\s+Air\b/i.test(item.model)
        ? 'air'
        : /^iPhone\s+SE\b/i.test(item.model)
          ? 'se'
          : 'other');
    if (!groups.has(id))
      groups.set(id, {
        id,
        label:
          id === 'air'
            ? 'iPhone Air'
            : id === 'se'
              ? 'iPhone SE'
              : id === 'other'
                ? 'รุ่นอื่น ๆ'
                : `iPhone ${id}`,
        models: [],
      });
    groups.get(id)!.models.push(item);
  }
  return [...groups.values()].sort((a, b) => {
    const first = Number(a.id);
    const second = Number(b.id);
    // Numbered generations ascend; named families follow in catalog order.
    if (Number.isFinite(first) && Number.isFinite(second)) return first - second;
    return Number.isFinite(first) ? -1 : Number.isFinite(second) ? 1 : 0;
  });
}
export function resolveDevice(
  models: BuybackCatalog['models'],
  model: string | null,
  storage: string | null,
): { model: string; storage: string; step: 'device' | 'storage' | 'questions' } {
  const found = models.find((item) => item.model === model);
  if (!found) return { model: '', storage: '', step: 'device' };
  return found.storages.some((item) => item.storage === storage)
    ? { model: found.model, storage: storage!, step: 'questions' }
    : { model: found.model, storage: '', step: 'storage' };
}
export function modelLabel(model: string): string {
  return model.replace(/^iPhone\b/i, 'iPhone');
}
export function storageLabel(storage: string): string {
  return storage.replace(/\s*(GB|TB)$/i, (_, unit: string) => ` ${unit.toUpperCase()}`);
}
