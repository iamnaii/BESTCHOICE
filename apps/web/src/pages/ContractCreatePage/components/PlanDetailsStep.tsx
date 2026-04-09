import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Product, InterestConfig, Customer } from '../types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import { contractPlanSchema, type ContractPlanFormData } from '@/lib/schemas';

/** Info icon with tooltip for financial field explanations */
function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block ml-1 text-muted-foreground/60 cursor-help hover:text-primary transition-colors"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <p>{text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export interface PlanDetailsStepProps {
  selectedProduct: Product | null;
  interestConfig: InterestConfig | null | undefined;
  selectedCustomer: Customer | null;
  sellingPrice: number;
  downPayment: number;
  setDownPayment: (v: number) => void;
  setDownPaymentTouched: (v: boolean) => void;
  totalMonths: number;
  setTotalMonths: (v: number) => void;
  minDownPct: number;
  minMonths: number;
  maxMonths: number;
  notes: string;
  setNotes: (v: string) => void;
  paymentDueDay: number;
  setPaymentDueDay: (v: number) => void;
  interestRate: number;
  storeCommPct: number;
  vatPct: number;
  principal: number;
  storeCommission: number;
  interestTotal: number;
  vatAmount: number;
  financedAmount: number;
  monthlyPayment: number;
  monthOptions: number[];
}

export function PlanDetailsStep({
  selectedProduct,
  interestConfig,
  selectedCustomer,
  sellingPrice,
  downPayment,
  setDownPayment,
  setDownPaymentTouched,
  totalMonths,
  setTotalMonths,
  minDownPct,
  minMonths,
  maxMonths,
  notes,
  setNotes,
  paymentDueDay,
  setPaymentDueDay,
  interestRate,
  storeCommPct,
  vatPct,
  principal,
  storeCommission,
  interestTotal,
  vatAmount,
  financedAmount,
  monthlyPayment,
  monthOptions,
}: PlanDetailsStepProps) {
  const form = useForm<ContractPlanFormData>({
    resolver: zodResolver(contractPlanSchema),
    defaultValues: {
      downPayment,
      totalMonths,
      paymentDueDay,
      notes: notes ?? '',
    },
    mode: 'onChange',
  });

  // Sync form values → parent state whenever the user edits
  useEffect(() => {
    const subscription = form.watch((values) => {
      if (values.downPayment !== undefined && values.downPayment !== downPayment) {
        setDownPaymentTouched(true);
        setDownPayment(values.downPayment);
      }
      if (values.totalMonths !== undefined && values.totalMonths !== totalMonths) {
        setTotalMonths(values.totalMonths);
      }
      if (values.paymentDueDay !== undefined && values.paymentDueDay !== paymentDueDay) {
        setPaymentDueDay(values.paymentDueDay);
      }
      if (values.notes !== undefined && values.notes !== notes) {
        setNotes(values.notes ?? '');
      }
    });
    return () => subscription.unsubscribe();
  }, [form, downPayment, totalMonths, paymentDueDay, notes, setDownPayment, setDownPaymentTouched, setTotalMonths, setPaymentDueDay, setNotes]);

  // Sync parent state → form when parent drives a value change (e.g., product change resets downPayment)
  useEffect(() => {
    form.setValue('downPayment', downPayment, { shouldValidate: true });
  }, [downPayment, form]);

  useEffect(() => {
    form.setValue('totalMonths', totalMonths, { shouldValidate: true });
  }, [totalMonths, form]);

  useEffect(() => {
    form.setValue('paymentDueDay', paymentDueDay, { shouldValidate: true });
  }, [paymentDueDay, form]);

  return (
    <Form {...form}>
    <div className="max-w-xl">
      <div className="rounded-xl border border-border/60 p-6 space-y-4">
        {/* Interest Config Badge */}
        {interestConfig && (
          <div className="bg-primary/5 border border-primary/30 rounded-lg p-3 flex items-center gap-2">
            <span className="text-xs text-primary">ใช้ดอกเบี้ยตาม:</span>
            <span className="text-sm font-medium text-primary">{interestConfig.name}</span>
            <span className="text-xs text-primary">({(interestRate * 100).toFixed(1)}% | ดาวน์ขั้นต่ำ {(minDownPct * 100).toFixed(0)}% | {minMonths}-{maxMonths} เดือน)</span>
          </div>
        )}


        <div className="bg-muted rounded-lg p-4">
          <div className="text-sm font-medium text-foreground mb-2">สินค้า: {selectedProduct?.brand} {selectedProduct?.model}</div>
          <div className="text-lg font-bold text-primary">{sellingPrice.toLocaleString()} ฿</div>
        </div>

        <FormField
          control={form.control}
          name="downPayment"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium text-foreground">
                เงินดาวน์ <InfoTip text="เงินที่ลูกค้าจ่ายล่วงหน้า หน้าร้านเก็บไว้ ไม่ผ่านไฟแนนซ์ — ขั้นต่ำกำหนดตามนโยบาย" />
              </FormLabel>
              <FormControl>
                <input
                  type="number"
                  {...field}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    field.onChange(val);
                    setDownPaymentTouched(true);
                    setDownPayment(val);
                  }}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                  min={0}
                />
              </FormControl>
              <div className="text-xs text-muted-foreground">ขั้นต่ำ {(minDownPct * 100).toFixed(0)}% = {(sellingPrice * minDownPct).toLocaleString()} ฿</div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="totalMonths"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium text-foreground">จำนวนงวด (เดือน)</FormLabel>
              <FormControl>
                <select
                  value={field.value}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    field.onChange(val);
                    setTotalMonths(val);
                  }}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                >
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>{m} เดือน</option>
                  ))}
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Payment Due Day */}
        <FormField
          control={form.control}
          name="paymentDueDay"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium text-foreground">วันที่ครบกำหนดชำระ (ตามวันเงินเดือนออก)</FormLabel>
              <FormControl>
                <select
                  value={field.value}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    field.onChange(val);
                    setPaymentDueDay(val);
                  }}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                >
                  {[...Array.from({ length: 28 }, (_, i) => i + 1), 31].map((d) => (
                    <option key={d} value={d}>{d === 31 ? 'สิ้นเดือน (วันสุดท้ายของเดือน)' : `วันที่ ${d} ของทุกเดือน`}</option>
                  ))}
                </select>
              </FormControl>
              <div className="text-xs text-muted-foreground">
                {selectedCustomer?.salaryPayDay && field.value === selectedCustomer.salaryPayDay
                  ? `กำหนดชำระตามวันเงินเดือนออก (วันที่ ${selectedCustomer.salaryPayDay})`
                  : `ลูกค้าจะต้องชำระเงิน${field.value === 31 ? 'ทุกสิ้นเดือน' : `ทุกวันที่ ${field.value} ของเดือน`}`
                }
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium text-foreground">หมายเหตุ</FormLabel>
              <FormControl>
                <textarea
                  {...field}
                  onChange={(e) => {
                    field.onChange(e.target.value);
                    setNotes(e.target.value);
                  }}
                  rows={2}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Calculation Summary */}
        <div className="bg-primary/5 rounded-lg p-4 space-y-2">
          <h3 className="text-sm font-semibold text-primary">สรุปการคำนวณ</h3>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">ราคาขาย</span>
            <span>{sellingPrice.toLocaleString()} ฿</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">เงินดาวน์</span>
            <span>-{downPayment.toLocaleString()} ฿</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">ยอดปล่อย <InfoTip text="ราคาขาย - เงินดาวน์ = ยอดที่ไฟแนนซ์ปล่อยให้ลูกค้าผ่อน" /></span>
            <span>{principal.toLocaleString()} ฿</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">ค่าคอมหน้าร้าน ({(storeCommPct * 100).toFixed(0)}%) <InfoTip text="ค่าคอมที่ไฟแนนซ์จ่ายให้หน้าร้าน เป็น % ของยอดปล่อย — รวมอยู่ในค่างวดลูกค้า" /></span>
            <span>{storeCommission.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">ดอกเบี้ยรวม ({(interestRate * 100).toFixed(1)}% x {totalMonths} เดือน)</span>
            <span>{interestTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">VAT ({(vatPct * 100).toFixed(0)}%)</span>
            <span>{vatAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">รวมยอดจัดไฟแนนซ์ <InfoTip text="ยอดปล่อย + ค่าคอม + ดอกเบี้ย + VAT = ยอดรวมที่ลูกค้าต้องผ่อนทั้งหมด" /></span>
            <span>{financedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span>
          </div>
          <div className="border-t pt-2 flex justify-between text-base font-bold text-primary">
            <span>ค่างวด/เดือน</span>
            <span>{monthlyPayment.toLocaleString()} ฿</span>
          </div>
          <div className="text-xs text-muted-foreground text-right">ชำระ{paymentDueDay === 31 ? 'ทุกสิ้นเดือน' : `ทุกวันที่ ${paymentDueDay}`}</div>
        </div>
      </div>
    </div>
    </Form>
  );
}
