import type { BuybackCatalog } from '@/types/buyback';
import { modelLabel, storageLabel, type SeriesGroup } from '../device-options';
import ChoiceButton from './ChoiceButton';
import { formatNumber } from '@/lib/format';
export default function DeviceStep({
  stage,
  groups,
  seriesId,
  model,
  storage,
  storages,
  disabled,
  onSeries,
  onModel,
  onStorage,
}: {
  stage: 'device' | 'storage';
  groups: SeriesGroup[];
  seriesId: string;
  model: string;
  storage: string;
  storages: BuybackCatalog['models'][number]['storages'];
  disabled: boolean;
  onSeries: (value: string) => void;
  onModel: (value: string) => void;
  onStorage: (value: string) => void;
}) {
  if (stage === 'storage')
    return (
      <div className="space-y-3">
        <p className="text-secondary-foreground">{modelLabel(model)}</p>
        <p className="text-sm">ดูได้ที่ การตั้งค่า → ทั่วไป → เกี่ยวกับ</p>
        <div className="grid gap-2 min-[700px]:grid-cols-2">
          {storages.map((item) => (
            <ChoiceButton
              key={item.storage}
              selected={storage === item.storage}
              disabled={disabled}
              onClick={() => onStorage(item.storage)}
              label={storageLabel(item.storage)}
            >
              <span className="font-semibold">{storageLabel(item.storage)}</span>
              <span className="mt-1 block text-sm">
                รับซื้อสูงสุด {formatNumber(Number(item.maxPrice))} บาท
              </span>
            </ChoiceButton>
          ))}
        </div>
        {storages.length === 0 && <p>รุ่นนี้ยังไม่เปิดรับซื้อ เลือกรุ่นอื่นหรือสอบถามร้าน</p>}
      </div>
    );
  const group = groups.find((item) => item.id === seriesId);
  return (
    <div className="space-y-5">
      <p className="text-sm">ไม่ต้องสมัครสมาชิก ไม่ต้องถ่ายรูปเครื่อง</p>
      <p className="rounded-lg bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground">
        รับซื้อและเทิร์นเฉพาะเครื่องโมเดลไทย
      </p>
      <section aria-label="กลุ่ม iPhone">
        <h2 className="font-semibold">1. เลือกกลุ่ม iPhone</h2>
        <p className="mb-3 mt-1 text-sm text-muted-foreground">
          เช่น iPhone 13 Pro ให้เลือก iPhone 13
        </p>
        <div className="grid grid-cols-2 gap-2 min-[500px]:grid-cols-3">
          {groups.map((item) => (
            <ChoiceButton
              key={item.id}
              label={`กลุ่ม ${item.label}`}
              selected={seriesId === item.id}
              onClick={() => onSeries(item.id)}
              disabled={disabled}
            >
              {item.label}
            </ChoiceButton>
          ))}
        </div>
      </section>
      {group && (
        <section aria-label="รุ่น">
          <h2 className="mb-3 font-semibold">2. เลือกรุ่นของ {group.label}</h2>
          <div className="grid gap-2 min-[700px]:grid-cols-2">
            {group.models.map((item) => (
              <ChoiceButton
                key={item.model}
                selected={model === item.model}
                onClick={() => onModel(item.model)}
                disabled={disabled}
              >
                {modelLabel(item.model)}
              </ChoiceButton>
            ))}
          </div>
        </section>
      )}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-secondary-foreground underline">
          ไม่แน่ใจว่ารุ่นอะไร
        </summary>
        <p className="text-sm">ดูชื่อรุ่นได้ที่ การตั้งค่า → ทั่วไป → เกี่ยวกับ</p>
      </details>
    </div>
  );
}
