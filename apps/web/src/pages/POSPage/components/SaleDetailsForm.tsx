import { UseFormReturn } from 'react-hook-form';
import {
  Form,
  FormField,
  FormItem,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { paymentMethods } from '@/lib/constants';
import { type PosSaleFormData } from '@/lib/schemas';
import type { Product } from '../types';
import type { SaleType } from '@/lib/constants';

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';
const selectClass = inputClass;

interface SaleDetailsFormProps {
  saleForm: UseFormReturn<PosSaleFormData>;
  saleType: SaleType;
  selectedProduct: Product | null;
  selectedPriceId: string;
  onPriceSelect: (priceId: string) => void;
  netAmount: number;
  transferAmount: number;
  sellingPrice: string;
  discount: string;
}

export default function SaleDetailsForm({
  saleForm,
  saleType,
  selectedProduct,
  selectedPriceId,
  onPriceSelect,
  netAmount,
  transferAmount,
  sellingPrice,
  discount,
}: SaleDetailsFormProps) {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <div className="text-sm font-semibold text-foreground">รายละเอียดการขาย</div>
      </CardHeader>
      <CardContent>
        <Form {...saleForm}>
          {/* Price picker from product system */}
          {selectedProduct && selectedProduct.prices.length > 0 && (
            <div className="mb-3">
              <label className="block text-xs text-muted-foreground mb-2">
                เลือกราคาขาย (จากระบบ) *
              </label>
              <div className="flex flex-wrap gap-2">
                {selectedProduct.prices.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onPriceSelect(p.id)}
                    className={`px-3 py-2 rounded-lg border-2 text-sm transition-all ${
                      selectedPriceId === p.id
                        ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/20'
                        : 'border-border text-foreground hover:border-input'
                    }`}
                  >
                    <div className="font-semibold">{parseFloat(p.amount).toLocaleString()} ฿</div>
                    <div className="text-xs text-muted-foreground">
                      {p.label}
                      {p.isDefault ? ' (ค่าเริ่มต้น)' : ''}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={saleForm.control as any}
              name="sellingPrice"
              render={({ field }) => (
                <FormItem>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    ราคาขาย *
                    <span className="ml-1 text-primary">(จากระบบ)</span>
                  </label>
                  <FormControl>
                    <input
                      type="number"
                      {...field}
                      value={field.value || 0}
                      className={`${inputClass} bg-muted`}
                      placeholder="0"
                      readOnly
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={saleForm.control as any}
              name="discount"
              render={({ field }) => (
                <FormItem>
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    ส่วนลด
                  </label>
                  <FormControl>
                    <input
                      type="number"
                      {...field}
                      value={field.value ?? 0}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                      className={inputClass}
                      placeholder="0"
                    />
                  </FormControl>
                  {parseFloat(sellingPrice) > 0 && (
                    <div className="flex gap-1 mt-1">
                      {[0, 5, 10].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() =>
                            saleForm.setValue(
                              'discount',
                              pct === 0 ? 0 : Math.round((parseFloat(sellingPrice) * pct) / 100),
                              { shouldValidate: true },
                            )
                          }
                          className={`px-2 py-0.5 text-[10px] rounded border ${
                            parseFloat(discount) ===
                              Math.round((parseFloat(sellingPrice) * pct) / 100) && pct > 0
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground hover:border-input'
                          }`}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Conditional fields by sale type */}
          {saleType === 'CASH' && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <FormField
                control={saleForm.control as any}
                name="paymentMethod"
                render={({ field }) => (
                  <FormItem>
                    <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      วิธีชำระเงิน
                    </label>
                    <FormControl>
                      <select {...field} className={selectClass}>
                        {paymentMethods.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={saleForm.control as any}
                name="amountReceived"
                render={({ field }) => (
                  <FormItem>
                    <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      เงินที่รับ
                    </label>
                    <FormControl>
                      <input
                        type="number"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)
                        }
                        className={inputClass}
                        placeholder={String(netAmount)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {saleType === 'EXTERNAL_FINANCE' && (
            <div className="space-y-3 mt-3">
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={saleForm.control as any}
                  name="financeCompany"
                  render={({ field }) => (
                    <FormItem>
                      <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                        บริษัทไฟแนนซ์ *
                      </label>
                      <FormControl>
                        <input
                          type="text"
                          {...field}
                          value={field.value ?? ''}
                          className={inputClass}
                          placeholder="ชื่อบริษัทไฟแนนซ์"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={saleForm.control as any}
                  name="contractNumber"
                  render={({ field }) => (
                    <FormItem>
                      <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                        เลขที่สัญญา
                      </label>
                      <FormControl>
                        <input
                          type="text"
                          {...field}
                          value={field.value ?? ''}
                          className={inputClass}
                          placeholder="เลขที่สัญญาไฟแนนซ์"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={saleForm.control as any}
                  name="downPayment"
                  render={({ field }) => (
                    <FormItem>
                      <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                        เงินดาวน์
                      </label>
                      <FormControl>
                        <input
                          type="number"
                          {...field}
                          value={field.value ?? 0}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          className={inputClass}
                          placeholder="0"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={saleForm.control as any}
                  name="paymentMethod"
                  render={({ field }) => (
                    <FormItem>
                      <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                        รับเงินดาวน์โดย
                      </label>
                      <FormControl>
                        <select {...field} className={selectClass}>
                          {paymentMethods.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              {/* Finance transfer amount highlight */}
              {transferAmount > 0 && (
                <div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
                  <div className="text-xs text-primary">
                    ยอดที่ไฟแนนซ์ต้องโอนให้ร้าน (หลังหักดาวน์)
                  </div>
                  <div className="text-lg font-bold text-primary">
                    {transferAmount.toLocaleString()} ฿
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <FormField
            control={saleForm.control as any}
            name="notes"
            render={({ field }) => (
              <FormItem className="mt-3">
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  หมายเหตุ
                </label>
                <FormControl>
                  <input
                    type="text"
                    {...field}
                    value={field.value ?? ''}
                    className={inputClass}
                    placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </Form>
      </CardContent>
    </Card>
  );
}
