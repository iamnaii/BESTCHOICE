// Asset module — EntryPage Section 2 (cost + VAT/WHT live calc)
// Pure presentation. Uses parent FormProvider for state + useAssetCalculation result.

import { useFormContext } from 'react-hook-form';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Receipt, ReceiptText, Coins, Gem } from 'lucide-react';
import { formatNumberDecimal } from '@/utils/formatters';
import type { AssetEntryFormValues } from '../schema';
import type { CalculationResult } from '../hooks/useAssetCalculation';
import { AssetSectionHeader } from './AssetSectionHeader';

const fmt = (n: number | string | null | undefined) =>
  n == null ? '-' : formatNumberDecimal(Number(n));

export function AssetEntrySection2Cost({ calc }: { calc: CalculationResult }) {
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext<AssetEntryFormValues>();
  const hasVat = watch('hasVat');
  const vatInclusive = watch('vatInclusive');
  const vatAccount = watch('vatAccount');
  const hasWht = watch('hasWht');
  const whtAccount = watch('whtAccount');
  const whtFormType = watch('whtFormType');
  const whtRate = watch('whtRate');
  const basePrice = watch('basePrice');

  return (
    <Card>
      <AssetSectionHeader number={2} title="โครงสร้างต้นทุน · VAT · WHT" />
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label>ราคาก่อน VAT *</Label>
            <Input type="number" step="0.01" {...register('basePrice')} />
            <p className="mt-1 text-xs text-muted-foreground">Base Price</p>
            {errors.basePrice && (
              <p className="text-sm text-destructive mt-1">{errors.basePrice.message}</p>
            )}
          </div>
          <div>
            <Label>ค่าขนส่ง</Label>
            <Input type="number" step="0.01" {...register('shippingCost')} />
            <p className="mt-1 text-xs text-muted-foreground">Capitalize → cost (TAS 16.16)</p>
          </div>
          <div>
            <Label>ค่าติดตั้ง</Label>
            <Input type="number" step="0.01" {...register('installationCost')} />
            <p className="mt-1 text-xs text-muted-foreground">Capitalize → cost</p>
          </div>
          <div>
            <Label>ค่า capitalize อื่น</Label>
            <Input type="number" step="0.01" {...register('otherCapitalized')} />
            <p className="mt-1 text-xs text-muted-foreground">ทดสอบ เตรียม ฯลฯ</p>
          </div>
        </div>

        {/* VAT */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Switch
              id="asset-has-vat"
              checked={hasVat}
              onCheckedChange={(v) => setValue('hasVat', v)}
            />
            <ReceiptText className="size-4 text-muted-foreground" />
            <Label htmlFor="asset-has-vat" className="font-semibold cursor-pointer">
              มีใบกำกับภาษี (VAT 7%)
            </Label>
            <span className="text-xs text-muted-foreground">· ม.82/3 ประมวลรัษฎากร</span>
          </div>
          {hasVat && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 ml-6">
              <div className="flex items-center gap-2">
                <Switch
                  id="asset-vat-inclusive"
                  checked={vatInclusive}
                  onCheckedChange={(v) => setValue('vatInclusive', v)}
                />
                <Label htmlFor="asset-vat-inclusive" className="cursor-pointer">
                  ราคารวม VAT แล้ว (inclusive)
                </Label>
              </div>
              <div>
                <Label>บัญชีภาษีซื้อ</Label>
                <Select
                  value={vatAccount}
                  onValueChange={(v) =>
                    setValue('vatAccount', v as AssetEntryFormValues['vatAccount'], {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="เลือก" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="11-4101">11-4101 ภาษีซื้อ (เครดิตได้)</SelectItem>
                    <SelectItem value="11-4102">11-4102 ภาษีซื้อรอเรียกเก็บ</SelectItem>
                  </SelectContent>
                </Select>
                {errors.vatAccount && (
                  <p className="text-sm text-destructive mt-1">{errors.vatAccount.message}</p>
                )}
              </div>
              <div>
                <Label>ยอด VAT (คำนวณ)</Label>
                <Input value={fmt(calc.vatAmount)} readOnly className="bg-muted" />
              </div>
            </div>
          )}
        </div>

        {/* WHT */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Switch
              id="asset-has-wht"
              checked={hasWht}
              onCheckedChange={(v) => setValue('hasWht', v)}
            />
            <Receipt className="size-4 text-muted-foreground" />
            <Label htmlFor="asset-has-wht" className="font-semibold cursor-pointer">
              หัก ณ ที่จ่าย WHT
            </Label>
            <span className="text-xs text-muted-foreground">
              · ทป.4/2528 · หักเฉพาะ &ldquo;ค่าบริการ&rdquo; — ไม่ใช่ค่าสินค้า (ม.50 ทวิ)
            </span>
          </div>
          {hasWht && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 ml-6">
              <div>
                <Label>ฐานคำนวณ WHT</Label>
                <Input
                  type="number"
                  step="0.01"
                  {...register('whtBaseAmount')}
                  placeholder="default = ค่าติดตั้ง"
                />
              </div>
              <div>
                <Label>อัตรา</Label>
                <Select
                  value={whtRate?.toString() ?? ''}
                  onValueChange={(v) =>
                    setValue('whtRate', Number(v), { shouldValidate: true })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="เลือก" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.01">1%</SelectItem>
                    <SelectItem value="0.02">2%</SelectItem>
                    <SelectItem value="0.03">3%</SelectItem>
                    <SelectItem value="0.05">5%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>แบบ ภ.ง.ด.</Label>
                <Select
                  value={whtFormType}
                  onValueChange={(v) =>
                    setValue('whtFormType', v as AssetEntryFormValues['whtFormType'])
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="เลือก" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PND3">ภ.ง.ด.3 (บุคคล)</SelectItem>
                    <SelectItem value="PND53">ภ.ง.ด.53 (นิติบุคคล)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>บัญชี WHT</Label>
                <Select
                  value={whtAccount}
                  onValueChange={(v) =>
                    setValue('whtAccount', v as AssetEntryFormValues['whtAccount'], {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="เลือก" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="21-3102">21-3102 PND3 ค้างจ่าย</SelectItem>
                    <SelectItem value="21-3103">21-3103 PND53 ค้างจ่าย</SelectItem>
                  </SelectContent>
                </Select>
                {errors.whtAccount && (
                  <p className="text-sm text-destructive mt-1">{errors.whtAccount.message}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Live totals — basePrice / purchaseCost (capitalized) / monthlyDepr / totalPayable.
            (calc.netBookValue starts equal to purchaseCost; not used here to avoid confusion.) */}
        <div className="rounded-lg bg-muted/60 p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Coins className="size-3.5" />
              ราคาก่อน VAT
            </div>
            <div className="text-xl font-semibold tabular-nums">{fmt(basePrice)}</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Gem className="size-3.5 text-info" />
              Capitalized Cost
            </div>
            <div className="text-xl font-semibold tabular-nums">{fmt(calc.purchaseCost)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">ค่าเสื่อม / เดือน</div>
            <div className="text-xl font-semibold tabular-nums text-warning">
              {fmt(calc.monthlyDepr)} <span className="text-xs">฿</span>
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">สุทธิที่จ่าย</div>
            <div className="text-xl font-semibold tabular-nums text-primary">
              {fmt(calc.totalPayable)} <span className="text-xs">฿</span>
            </div>
          </div>
        </div>

        {/* Residual + life */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>มูลค่าซาก (residual)</Label>
            <Input type="number" step="0.01" {...register('residualValue')} />
            {errors.residualValue && (
              <p className="text-sm text-destructive mt-1">{errors.residualValue.message}</p>
            )}
          </div>
          <div>
            <Label>อายุการใช้งาน (เดือน) *</Label>
            <Input type="number" step="1" {...register('usefulLifeMonths')} />
            {errors.usefulLifeMonths && (
              <p className="text-sm text-destructive mt-1">{errors.usefulLifeMonths.message}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
