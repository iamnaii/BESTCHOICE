// Asset module — EntryPage Section 2 (cost + VAT/WHT live calc)
// Pure presentation. Uses parent FormProvider for state + useAssetCalculation result.

import { useFormContext } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { formatNumberDecimal } from '@/utils/formatters';
import type { AssetEntryFormValues } from '../schema';
import type { CalculationResult } from '../hooks/useAssetCalculation';

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>2. รายละเอียดต้นทุน + ภาษี</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label>ราคาทุน (basePrice) *</Label>
            <Input type="number" step="0.01" {...register('basePrice')} />
            {errors.basePrice && (
              <p className="text-sm text-destructive mt-1">{errors.basePrice.message}</p>
            )}
          </div>
          <div>
            <Label>ค่าขนส่ง</Label>
            <Input type="number" step="0.01" {...register('shippingCost')} />
          </div>
          <div>
            <Label>ค่าติดตั้ง</Label>
            <Input type="number" step="0.01" {...register('installationCost')} />
          </div>
          <div>
            <Label>ค่าใช้จ่ายอื่น (capitalize)</Label>
            <Input type="number" step="0.01" {...register('otherCapitalized')} />
          </div>
        </div>

        {/* VAT */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Switch checked={hasVat} onCheckedChange={(v) => setValue('hasVat', v)} />
            <Label>มี VAT 7%</Label>
          </div>
          {hasVat && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 ml-6">
              <div className="flex items-center gap-2">
                <Switch
                  checked={vatInclusive}
                  onCheckedChange={(v) => setValue('vatInclusive', v)}
                />
                <Label>ราคารวม VAT แล้ว (inclusive)</Label>
              </div>
              <div>
                <Label>บัญชี VAT</Label>
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
            <Switch checked={hasWht} onCheckedChange={(v) => setValue('hasWht', v)} />
            <Label>มี WHT (หัก ณ ที่จ่าย)</Label>
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

        {/* Live totals */}
        <div className="rounded-lg bg-muted p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-muted-foreground">ราคาทุนรวม (purchaseCost)</div>
            <div className="text-xl font-semibold tabular-nums">{fmt(calc.purchaseCost)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">ยอดที่ต้องจ่ายจริง</div>
            <div className="text-xl font-semibold tabular-nums">{fmt(calc.totalPayable)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">ค่าเสื่อม/เดือน</div>
            <div className="text-xl font-semibold tabular-nums">{fmt(calc.monthlyDepr)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">NBV เริ่มต้น</div>
            <div className="text-xl font-semibold tabular-nums">{fmt(calc.netBookValue)}</div>
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
