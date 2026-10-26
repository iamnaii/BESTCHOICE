import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { Package, Printer } from 'lucide-react';
import api from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import ParcelLabelCard from './ParcelLabelCard';
import {
  CARRIERS,
  buildParcelLabelDraft,
  labelStyles,
  readLabelFormat,
  writeLabelFormat,
  type CarrierCode,
  type ParcelLabelDraft,
  type ParcelLabelFormat,
  type ParcelLabelSources,
} from './parcelLabel';

/**
 * ใบปะหน้าพัสดุจากใบขาย (A6 · 2026-10-22) — `/sales/:id/parcel-label`
 * เติมผู้รับจากลูกค้า แก้ได้ทุกช่องก่อนพิมพ์ (ไม่เขียนกลับไปที่ลูกค้า) · ของในกล่อง/ผู้ส่ง/QR มาจากใบขายและตั้งค่าบริษัท ·
 * รูปแบบกระดาษ (ฉลาก 100×150 / A4) จำต่อเครื่องใน localStorage — เครื่องพิมพ์ต่างกันต่อสาขา จึงไม่ใช่การตั้งค่ากลาง
 */

type SaleDetail = ParcelLabelSources['sale'] & { deletedAt?: string | null };
type CustomerDetail = NonNullable<ParcelLabelSources['customer']> & { id: string };
type CompanyPublic = { shop: NonNullable<ParcelLabelSources['company']> | null };

const FORMAT_LABEL: Record<ParcelLabelFormat, string> = {
  A4: 'A4 (ตัดตามเส้นประ)',
  LABEL_100x150: 'ฉลาก 100 × 150 มม.',
};

export default function ParcelLabelPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ParcelLabelDraft | null>(null);
  const [format, setFormat] = useState<ParcelLabelFormat>(() => readLabelFormat());

  const saleQuery = useQuery<SaleDetail>({
    queryKey: ['sale', id],
    enabled: id.length > 0,
    queryFn: async () => (await api.get(`/sales/${encodeURIComponent(id)}`)).data,
  });
  const customerId = saleQuery.data?.customer.id;
  const customerQuery = useQuery<CustomerDetail>({
    queryKey: ['customer', customerId],
    enabled: !!customerId,
    queryFn: async () => (await api.get(`/customers/${encodeURIComponent(customerId!)}`)).data,
  });
  const companyQuery = useQuery<CompanyPublic>({
    queryKey: ['company-public'],
    queryFn: async () => (await api.get('/company/public')).data,
  });

  useDocumentTitle(saleQuery.data ? `ใบปะหน้าพัสดุ ${saleQuery.data.saleNumber}` : 'ใบปะหน้าพัสดุ');

  // ร่างเมื่อข้อมูลครบ และร่างใหม่เมื่อ :id เปลี่ยนขณะหน้ายัง mount (back/forward) — ไม่งั้นฟอร์ม/QR ค้างใบเก่า
  // ลูกค้า/บริษัทโหลดไม่ได้ยังพิมพ์ได้ (ช่องว่างให้กรอกเอง)
  const sale = saleQuery.data;
  const customerSettled = !!customerId && !customerQuery.isPending;
  const companySettled = !companyQuery.isPending;
  useEffect(() => {
    if (!sale || draft?.saleId === sale.id || !customerSettled || !companySettled) return;
    setDraft(
      buildParcelLabelDraft({
        sale,
        customer: customerQuery.data ?? null,
        company: companyQuery.data?.shop ?? null,
        origin: window.location.origin,
      }),
    );
  }, [draft, sale, customerSettled, companySettled, customerQuery.data, companyQuery.data]);

  const update = <K extends keyof ParcelLabelDraft>(key: K, value: ParcelLabelDraft[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const chooseFormat = (next: ParcelLabelFormat) => {
    setFormat(next);
    writeLabelFormat(next);
  };

  const voided = !!sale?.deletedAt;

  return (
    <div>
      <style>{labelStyles(format)}</style>
      <div className="print:hidden">
        <PageHeader
          icon={<Package aria-hidden="true" className="size-4" strokeWidth={1.75} />}
          title="ใบปะหน้าพัสดุ"
          subtitle={sale ? `ใบขาย ${sale.saleNumber} · ${sale.customer.name}` : 'กำลังโหลดใบขาย…'}
          onBack={() => navigate(id ? `/sales?saleId=${encodeURIComponent(id)}` : '/sales')}
          help="ชื่อ เบอร์ และที่อยู่เติมจากข้อมูลลูกค้า แก้ได้ก่อนพิมพ์ (ไม่เปลี่ยนข้อมูลลูกค้า) · เลือกขนส่งแล้วช่องบนกระดาษจะถูกติ๊กให้ · QR เปิดใบขายในระบบจากกล้องมือถือ · เลือกรูปแบบกระดาษให้ตรงกับเครื่องพิมพ์ของสาขา"
          helpLabel="วิธีใช้"
        />
      </div>

      <QueryBoundary isLoading={saleQuery.isLoading} isError={saleQuery.isError} error={saleQuery.error} onRetry={saleQuery.refetch}>
        {draft && (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
            <section className="print:hidden min-w-0 space-y-4 rounded-xl border border-border bg-card p-4">
              {voided && (
                <Alert variant="destructive" appearance="light">
                  <AlertTitle>ใบขายนี้ถูกยกเลิกแล้ว</AlertTitle>
                  <AlertDescription>พิมพ์ใบปะหน้าไม่ได้ — ถ้าต้องส่งเครื่องจริง ให้เปิดใบขายใหม่ก่อน</AlertDescription>
                </Alert>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="pl-name">ชื่อผู้รับ</Label>
                  <Input id="pl-name" value={draft.recipientName} onChange={(e) => update('recipientName', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pl-phone">เบอร์โทร</Label>
                  <Input id="pl-phone" inputMode="tel" value={draft.phone} onChange={(e) => update('phone', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pl-cod">เก็บเงินปลายทาง</Label>
                  <Input id="pl-cod" value={draft.cod} onChange={(e) => update('cod', e.target.value)} placeholder="ไม่มี หรือจำนวนเงิน" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="pl-address">ที่อยู่</Label>
                  <Textarea id="pl-address" rows={3} value={draft.addressLines} onChange={(e) => update('addressLines', e.target.value)} placeholder="บ้านเลขที่ หมู่ ซอย ถนน ตำบล อำเภอ" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pl-province">จังหวัด</Label>
                  <Input id="pl-province" value={draft.province} onChange={(e) => update('province', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pl-zip">รหัสไปรษณีย์</Label>
                  <Input id="pl-zip" inputMode="numeric" value={draft.postalCode} onChange={(e) => update('postalCode', e.target.value)} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="pl-note">หมายเหตุถึงขนส่ง</Label>
                  <Input id="pl-note" value={draft.note} onChange={(e) => update('note', e.target.value)} placeholder="เช่น โทรก่อนส่ง / ฝากไว้หน้าบ้าน" />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-sm font-medium">ขนส่ง</div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="ขนส่ง">
                  {CARRIERS.map((carrier) => {
                    const on = draft.carrier === carrier.code;
                    return (
                      <Button
                        key={carrier.code}
                        type="button"
                        variant={on ? 'primary' : 'outline'}
                        aria-pressed={on}
                        onClick={() => update('carrier', on ? null : (carrier.code as CarrierCode))}
                      >
                        {carrier.label}
                      </Button>
                    );
                  })}
                  <Button type="button" variant="ghost" onClick={() => update('carrier', null)} disabled={draft.carrier === null}>
                    ยังไม่เลือก (ติ๊กมือ)
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pl-format">รูปแบบกระดาษ</Label>
                  <NativeSelect id="pl-format" value={format} onChange={(e) => chooseFormat(e.target.value as ParcelLabelFormat)}>
                    <option value="A4">{FORMAT_LABEL.A4}</option>
                    <option value="LABEL_100x150">{FORMAT_LABEL.LABEL_100x150}</option>
                  </NativeSelect>
                  <p className="text-xs text-muted-foreground">จำไว้ที่เครื่องนี้ — เลือกให้ตรงกับเครื่องพิมพ์ของสาขา</p>
                </div>
                <div className="space-y-1.5 text-sm">
                  <div className="font-medium">ของในกล่อง · ผู้ส่ง</div>
                  <p className="text-muted-foreground">
                    {draft.item.title}
                    {draft.item.imei ? ` · IMEI ${draft.item.imei}` : ''}
                    {draft.item.extras.length > 0 ? ` · + ${draft.item.extras.join(' · ')}` : ''}
                  </p>
                  <p className="text-muted-foreground">
                    ผู้ส่ง {draft.sender.name}
                    {draft.sender.phone ? ` · โทร ${draft.sender.phone}` : ''} — อ่านจากใบขายและตั้งค่าบริษัท แก้ที่นี่ไม่ได้
                  </p>
                </div>
              </div>

              {!voided && (
                <Button type="button" size="lg" onClick={() => window.print()} className="h-auto items-center justify-start gap-3 px-4 py-3.5 text-left">
                  <Printer aria-hidden="true" className="size-5" />
                  <span className="flex-1">
                    <span className="block text-[15px] font-semibold leading-snug">พิมพ์ใบปะหน้า</span>
                    <span className="block text-[11px] font-normal leading-snug opacity-85">{FORMAT_LABEL[format]}</span>
                  </span>
                </Button>
              )}
            </section>

            <section className="parcel-print rounded-xl border border-border bg-card p-4 print:border-0 print:bg-transparent print:p-0">
              <div className="print:hidden mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">ตัวอย่าง (ขนาดจริง)</div>
              <div className="flex justify-center overflow-x-auto print:block print:overflow-visible">
                <ParcelLabelCard draft={draft} />
              </div>
            </section>
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}
