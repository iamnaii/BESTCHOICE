import { FormNumberInput } from '@/components/ui/FormNumberInput';
// Asset module — EntryPage Section 2 (cost structure, expense-style line row)
// Pure presentation. Uses parent FormProvider for state + useAssetCalculation result.
//
// Layout mirrors the expense-recording page (บันทึกรายจ่าย):
//   line row (qty · unit price · discount · VAT% · WHT% · before-tax)
//   + inclusive/exclusive toggle + capitalize fields + residual/life + summary.
// basePrice is derived from the line (qty × unitPrice − discount) and kept in
// sync via setValue so the rest of the form (calc, refines, submit) is unchanged.

import { useId as useExtraFieldId, useId as useUiFieldId, useEffect } from 'react';
import { useFormContext } from 'react-hook-form';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Coins, Gem, AlertTriangle, PackagePlus } from 'lucide-react';
import { formatNumberDecimal } from '@/utils/formatters';
import type { AssetEntryFormValues } from '../schema';
import type { CalculationResult } from '../hooks/useAssetCalculation';
import { AssetSectionHeader } from './AssetSectionHeader';

const fmt = (n: number | string | null | undefined) =>
  n == null ? '-' : formatNumberDecimal(Number(n));

export function AssetEntrySection2Cost({ calc }: { calc: CalculationResult }) {
  const uiExtraFieldId = useExtraFieldId();
  const uiFieldId = useUiFieldId();
  const {
    setValue,
    watch,
    formState: { errors },
  } = useFormContext<AssetEntryFormValues>();

  const quantity = watch('quantity');
  const unitPrice = watch('unitPrice');
  const discount = watch('discount');
  const hasVat = watch('hasVat');
  const vatInclusive = watch('vatInclusive');
  const vatAccount = watch('vatAccount');
  const hasWht = watch('hasWht');
  const whtRate = watch('whtRate');
  const whtAccount = watch('whtAccount');
  const whtFormType = watch('whtFormType');
  const whtBaseAmount = watch('whtBaseAmount');
  const installationCost = watch('installationCost');

  // Derive basePrice = qty × unitPrice − discount (clamped ≥ 0). Effect deps are
  // the line inputs only, so this never loops (basePrice doesn't feed derivedBase).
  const derivedBase = Math.max(
    0,
    (Number(quantity) || 0) * (Number(unitPrice) || 0) - (Number(discount) || 0),
  );
  useEffect(() => {
    setValue('basePrice', derivedBase, { shouldValidate: true });
  }, [derivedBase, setValue]);

  const vatPercent = hasVat ? '7' : '0';
  const whtPercent = hasWht && whtRate ? String(Math.round(Number(whtRate) * 100)) : '0';

  const onVatPercentChange = (v: string) => {
    const on = v === '7';
    setValue('hasVat', on, { shouldValidate: true });
    if (on && !vatAccount) {
      setValue('vatAccount', '11-4101', { shouldValidate: true });
    }
  };

  const onWhtPercentChange = (v: string) => {
    if (v === '0') {
      setValue('hasWht', false, { shouldValidate: true });
      setValue('whtRate', undefined, { shouldValidate: true });
    } else {
      setValue('hasWht', true);
      setValue('whtRate', Number(v) / 100, { shouldValidate: true });
      if (!whtAccount) setValue('whtAccount', '21-3103', { shouldValidate: true });
      if (!whtFormType) setValue('whtFormType', 'PND53');
    }
  };

  const noWhtBase =
    hasWht && (Number(whtBaseAmount) || 0) === 0 && (Number(installationCost) || 0) === 0;

  return (
    <Card>
      <AssetSectionHeader number={2} title="โครงสร้างต้นทุน · VAT · WHT" />
      <CardContent className="space-y-4">
        {/* Line-item row — same shape as the expense-recording page */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <div>
            <Label htmlFor={`${uiExtraFieldId}-1`}>จำนวน</Label>
            <FormNumberInput id={`${uiExtraFieldId}-1`} step="1" min="0" name={'quantity'} />
          </div>
          <div>
            <Label htmlFor={`${uiExtraFieldId}-2`}>ราคา/หน่วย</Label>
            <FormNumberInput id={`${uiExtraFieldId}-2`} step="0.01" min="0" name={'unitPrice'} />
          </div>
          <div>
            <Label htmlFor={`${uiExtraFieldId}-3`}>ส่วนลด</Label>
            <FormNumberInput id={`${uiExtraFieldId}-3`} step="0.01" min="0" name={'discount'} />
          </div>
          <div>
            <Label htmlFor={`${uiFieldId}-1`}>VAT%</Label>
            <Select value={vatPercent} onValueChange={onVatPercentChange}>
              <SelectTrigger id={`${uiFieldId}-1`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0%</SelectItem>
                <SelectItem value="7">7%</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${uiFieldId}-2`}>WHT%</Label>
            <Select value={whtPercent} onValueChange={onWhtPercentChange}>
              <SelectTrigger id={`${uiFieldId}-2`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0%</SelectItem>
                <SelectItem value="1">1%</SelectItem>
                <SelectItem value="2">2%</SelectItem>
                <SelectItem value="3">3%</SelectItem>
                <SelectItem value="5">5%</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${uiFieldId}-3`}>ก่อนภาษี</Label>
            <Input id={`${uiFieldId}-3`}
              value={fmt(calc.basePrice)}
              readOnly
              className="bg-muted text-right tabular-nums"
            />
          </div>
        </div>
        {errors.basePrice && (
          <p className="text-sm text-destructive">{errors.basePrice.message}</p>
        )}

        {/* VAT price-type toggle + purchase-tax account (only when VAT 7%) */}
        {hasVat && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-r-lg border-l-4 border-info bg-info/5 p-3">
            <div className="flex items-center gap-5 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="vat-price-type"
                  className="accent-primary"
                  checked={!!vatInclusive}
                  onChange={() => setValue('vatInclusive', true)}
                />
                ราคารวม VAT แล้ว
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="vat-price-type"
                  className="accent-primary"
                  checked={!vatInclusive}
                  onChange={() => setValue('vatInclusive', false)}
                />
                ราคายังไม่รวม VAT
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor={`${uiFieldId}-4`} className="whitespace-nowrap text-xs text-muted-foreground">
                บัญชีภาษีซื้อ
              </Label>
              <Select
                value={vatAccount}
                onValueChange={(v) =>
                  setValue('vatAccount', v as AssetEntryFormValues['vatAccount'], {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger id={`${uiFieldId}-4`} className="h-9 w-[250px]">
                  <SelectValue placeholder="เลือก" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="11-4101">ภาษีซื้อ</SelectItem>
                  <SelectItem value="11-4102">ภาษีซื้อรอเรียกเก็บ</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-muted-foreground">
              ยอด VAT (คำนวณ):{' '}
              <span className="font-semibold tabular-nums text-foreground">
                {fmt(calc.vatAmount)}
              </span>
            </div>
            {errors.vatAccount && (
              <p className="w-full text-sm text-destructive">{errors.vatAccount.message}</p>
            )}
          </div>
        )}

        {/* WHT detail (only when WHT > 0) — applies to the service/installation portion */}
        {hasWht && (
          <div className="space-y-3 rounded-r-lg border-l-4 border-warning bg-warning/5 p-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <Label htmlFor={`${uiFieldId}-5`}>แบบ ภ.ง.ด.</Label>
                <Select
                  value={whtFormType}
                  onValueChange={(v) =>
                    setValue('whtFormType', v as AssetEntryFormValues['whtFormType'])
                  }
                >
                  <SelectTrigger id={`${uiFieldId}-5`}>
                    <SelectValue placeholder="เลือก" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PND3">ภ.ง.ด.3 (บุคคล)</SelectItem>
                    <SelectItem value="PND53">ภ.ง.ด.53 (นิติบุคคล)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={`${uiFieldId}-6`}>บัญชี WHT</Label>
                <Select
                  value={whtAccount}
                  onValueChange={(v) =>
                    setValue('whtAccount', v as AssetEntryFormValues['whtAccount'], {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger id={`${uiFieldId}-6`}>
                    <SelectValue placeholder="เลือก" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="21-3102">ภ.ง.ด.3 ค้างจ่าย</SelectItem>
                    <SelectItem value="21-3103">ภ.ง.ด.53 ค้างจ่าย</SelectItem>
                  </SelectContent>
                </Select>
                {errors.whtAccount && (
                  <p className="mt-1 text-sm text-destructive">{errors.whtAccount.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor={`${uiExtraFieldId}-4`}>ฐานคำนวณ WHT (ค่าบริการ)</Label>
                <FormNumberInput id={`${uiExtraFieldId}-4`}
                  step="0.01"
                  name={'whtBaseAmount'}
                  placeholder="ค่าเริ่มต้นเท่ากับค่าติดตั้ง"
                />
              </div>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              WHT หักเฉพาะ &ldquo;ค่าบริการ/ค่าติดตั้ง&rdquo; ตาม ทป.4/2528 — ไม่ใช่ค่าสินค้า · ยอดหัก:{' '}
              <span className="font-semibold tabular-nums text-foreground">
                {fmt(calc.whtAmount)}
              </span>
            </p>
            {noWhtBase && (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
                <p className="flex items-center gap-1.5 font-medium text-warning-strong">
                  <AlertTriangle className="size-4" />
                  ไม่มีฐานคำนวณ WHT
                </p>
                <p className="mt-1 text-muted-foreground">
                  ไม่มีค่าติดตั้งและไม่ระบุฐานคำนวณ WHT → ระบบจะไม่หัก WHT (= 0). ถ้าซื้อสินค้าอย่างเดียวให้ตั้ง WHT% = 0
                </p>
              </div>
            )}
          </div>
        )}

        {/* Capitalize fields (TAS 16.16 — included in asset cost) */}
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <PackagePlus className="size-4 text-muted-foreground" />
            ต้นทุนเพิ่มเติมที่รวมในราคาทุนสินทรัพย์
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <Label htmlFor={`${uiExtraFieldId}-5`}>ค่าขนส่ง</Label>
              <FormNumberInput id={`${uiExtraFieldId}-5`} step="0.01" min="0" name={'shippingCost'} />
            </div>
            <div>
              <Label htmlFor={`${uiExtraFieldId}-6`}>ค่าติดตั้ง</Label>
              <FormNumberInput id={`${uiExtraFieldId}-6`} step="0.01" min="0" name={'installationCost'} />
            </div>
            <div>
              <Label htmlFor={`${uiExtraFieldId}-7`}>ต้นทุนอื่น ๆ</Label>
              <FormNumberInput id={`${uiExtraFieldId}-7`} step="0.01" min="0" name={'otherCapitalized'} />
            </div>
          </div>
        </div>

        {/* Residual + useful life */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor={`${uiExtraFieldId}-8`}>มูลค่าซาก</Label>
            <FormNumberInput id={`${uiExtraFieldId}-8`} step="0.01" min="0" name={'residualValue'} />
            {errors.residualValue && (
              <p className="mt-1 text-sm text-destructive">{errors.residualValue.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor={`${uiExtraFieldId}-9`}>อายุการใช้งาน (เดือน) *</Label>
            <FormNumberInput id={`${uiExtraFieldId}-9`} step="1" min="1" name={'usefulLifeMonths'} />
            {errors.usefulLifeMonths && (
              <p className="mt-1 text-sm text-destructive">{errors.usefulLifeMonths.message}</p>
            )}
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-4 text-sm md:grid-cols-4">
          <div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Coins className="size-3.5" />
              ราคาก่อน VAT
            </div>
            <div className="text-xl font-semibold tabular-nums">{fmt(calc.basePrice)}</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Gem className="size-3.5 text-info" />
              ราคาทุนสินทรัพย์
            </div>
            <div className="text-xl font-semibold tabular-nums">{fmt(calc.purchaseCost)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">ค่าเสื่อม/เดือน</div>
            <div className="text-xl font-semibold tabular-nums text-warning-strong">
              {fmt(calc.monthlyDepr)} <span className="text-xs">฿</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              ค่าเสื่อม/วัน {fmt(calc.dailyDepr)} ฿
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">สุทธิที่จ่าย</div>
            <div className="text-xl font-semibold tabular-nums text-primary">
              {fmt(calc.totalPayable)} <span className="text-xs">฿</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
