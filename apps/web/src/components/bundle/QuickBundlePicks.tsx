import { useState } from 'react';
import { isAccessoryCompatible, type AccessoryDevice } from '@installment/shared';
import { useQueries } from '@tanstack/react-query';
import { Plus, Check, LoaderCircle } from 'lucide-react';
import api from '@/lib/api';
import type { BundleProduct } from './BundleSearch';

const presets = ['ฟิล์ม', 'เคส', 'ชุดชาร์จ'];

interface Props<T extends BundleProduct> {
  branchId?: string;
  device?: AccessoryDevice & { id: string };
  excludeIds: string[];
  disabled?: boolean;
  onAdd: (product: T) => void;
  onSearch: (search: string) => void;
}

/** Shortcuts select real accessory units; a category name is never submitted as stock. */
export default function QuickBundlePicks<T extends BundleProduct>({
  branchId,
  device,
  excludeIds,
  disabled,
  onAdd,
  onSearch,
}: Props<T>) {
  const [active, setActive] = useState<string | null>(null);
  const queries = useQueries({
    queries: presets.map((search) => ({
      queryKey: ['bundle-quick-picks', branchId, device?.id, device?.brand, device?.model, search],
      enabled: !!branchId && !!device,
      queryFn: async () => {
        const { data } = await api.get('/products', {
          params: {
            search,
            status: 'IN_STOCK',
            category: 'ACCESSORY',
            branchId,
            compatibleWithProductId: device?.id,
            limit: '10',
          },
        });
        return {
          products: (data.data ?? []) as T[],
          total: Number(data.total ?? data.meta?.total ?? data.data?.length ?? 0),
        };
      },
    })),
  });
  const choices = queries.map(
    (query) =>
      query.data?.products.filter(
        (p) => !!device && isAccessoryCompatible(p, device) && !excludeIds.includes(p.id),
      ) ?? [],
  );
  const activeIndex = presets.indexOf(active ?? '');
  const add = (product: T) => {
    if (disabled) return;
    onAdd(product);
    setActive(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" aria-label="ของแถมด่วน">
        {presets.map((label, index) => {
          const query = queries[index];
          const selected = !!query.data?.products.some((p) => excludeIds.includes(p.id));
          const empty =
            !!branchId &&
            query.isSuccess &&
            choices[index].length === 0 &&
            (query.data?.total ?? 0) <= 10;
          return (
            <button
              key={label}
              type="button"
              disabled={disabled || !branchId || !device || query.isFetching || empty}
              aria-expanded={active === label}
              onClick={() => {
                if (query.isError) {
                  void query.refetch();
                  return;
                }
                if (choices[index].length === 1 && query.data?.total === 1) add(choices[index][0]);
                else setActive(active === label ? null : label);
              }}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm font-medium leading-snug hover:border-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
            >
              {query.isFetching && branchId ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : selected ? (
                <Check className="size-4 text-primary" aria-hidden />
              ) : (
                <Plus className="size-4" aria-hidden />
              )}
              {label}
              {empty && (
                <span className="text-xs text-muted-foreground">
                  {selected ? 'เลือกแล้ว' : 'ไม่มีตรงรุ่น'}
                </span>
              )}
              {query.isError && <span className="text-xs text-destructive">ลองใหม่</span>}
            </button>
          );
        })}
      </div>
      {device && (
        <p className="text-xs text-muted-foreground leading-snug">
          สำหรับ {device.brand} {device.model} · แสดงเฉพาะรุ่นที่ระบุว่ารองรับ
        </p>
      )}
      {!branchId && (
        <p className="text-xs text-muted-foreground leading-snug">
          เลือกสินค้าหลักก่อน เพื่อดูของแถมในสาขาเดียวกัน
        </p>
      )}
      {activeIndex >= 0 && branchId && (
        <div
          className="rounded-lg border border-border bg-muted/30 p-3 space-y-2"
          aria-label={`เลือก${active}`}
        >
          <p className="text-xs font-medium leading-snug">
            เลือก{active}สำหรับ {device?.model} · ราคา 0 บาท
          </p>
          {choices[activeIndex].map((product) => (
            <button
              key={product.id}
              type="button"
              disabled={disabled}
              onClick={() => add(product)}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm leading-snug hover:border-primary disabled:opacity-50"
            >
              <span className="min-w-0 break-words">
                {product.name}
                {product.imeiSerial && (
                  <span className="block text-xs text-muted-foreground">{product.imeiSerial}</span>
                )}
              </span>
              <Plus className="size-4 shrink-0 text-primary" aria-hidden />
            </button>
          ))}
          {choices[activeIndex].length === 0 && (
            <p className="text-xs text-muted-foreground">ไม่มีรายการที่ยังไม่ได้เลือกในชุดนี้</p>
          )}
          {(queries[activeIndex].data?.total ?? 0) > 10 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onSearch(active!);
                setActive(null);
              }}
              className="min-h-11 text-sm text-primary hover:underline"
            >
              ค้นหา{active}เพิ่มเติมสำหรับรุ่นนี้
            </button>
          )}
        </div>
      )}
    </div>
  );
}
