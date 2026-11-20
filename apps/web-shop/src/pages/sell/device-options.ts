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
        label: id === 'air' ? 'แอร์' : id === 'se' ? 'เอสอี' : id === 'other' ? 'อื่น ๆ' : id,
        models: [],
      });
    groups.get(id)!.models.push(item);
  }
  return [...groups.values()];
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
  return model
    .replace(/^iPhone\b/i, 'ไอโฟน')
    .replace(/Pro Max/gi, 'โปรแม็กซ์')
    .replace(/Pro/gi, 'โปร')
    .replace(/Plus/gi, 'พลัส')
    .replace(/mini/gi, 'มินิ')
    .replace(/Air/gi, 'แอร์')
    .replace(/SE/g, 'เอสอี');
}
export function storageLabel(storage: string): string {
  return storage.replace(/\s*GB$/i, ' กิกะไบต์').replace(/\s*TB$/i, ' เทระไบต์');
}
