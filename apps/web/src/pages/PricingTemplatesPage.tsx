import { NumberInput } from '@/components/ui/NumberInput';
import ScreenTable from '@/components/ui/ScreenTable';
import { NativeSelect } from '@/components/ui/native-select';
import { useId as useUiFieldId, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { downloadExcelBuffer, importFromExcel } from '@/utils/excel.util';
import api, { getErrorMessage } from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Card, CardContent } from '@/components/ui/card';
import { formControlClass } from '@/components/ui/form-styles';
import { cn } from '@/lib/utils';
import { ImportReviewDialog } from '@/components/import/ImportReviewDialog';
import { ImportBatchError } from '@/utils/excel-cell.util';
import {
  PRICING_IMPORT_HEADERS,
  buildPricingImportReview,
  sendPricingImport,
  type ExistingPricingTemplate,
  type PricingImportItem,
  type PricingImportReview,
} from './pricing-templates/pricingTemplateImport';

interface PricingTemplate {
  deviceOrigin?: string;
  id: string;
  brand: string;
  model: string;
  storage: string | null;
  category: string;
  hasWarranty: boolean | null;
  cashPrice: string;
  installmentBestchoicePrice: string;
  installmentFinancePrice: string;
  isActive: boolean;
  rate1DownPayment: string | number | null;
  rate1TermMonths: number | null;
  rate2DownPayment: number | null;
  rate2TermMonths: number | null;
}

const CATEGORIES = [
  { value: 'PHONE_NEW', label: 'มือ 1' },
  { value: 'PHONE_USED', label: 'มือ 2' },
];

const defaultForm = {
  deviceOrigin: 'UNSPECIFIED',
  brand: '',
  model: '',
  storage: '',
  category: 'PHONE_NEW' as string,
  hasWarranty: null as boolean | null,
  cashPrice: '',
  installmentBestchoicePrice: '',
  installmentFinancePrice: '',
  rate1DownPayment: undefined as number | undefined,
  rate1TermMonths: undefined as number | undefined,
  rate2DownPayment: undefined as number | undefined,
  rate2TermMonths: undefined as number | undefined,
};

export default function PricingTemplatesPage() {
  const uiFieldId = useUiFieldId();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterDeviceOrigin, setFilterDeviceOrigin] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<PricingImportReview | null>(null);
  const [importProgress, setImportProgress] = useState<string | null>(null);

  const { data: templates = [], isLoading, isError, error, refetch } = useQuery<PricingTemplate[]>({
    queryKey: ['pricing-templates', filterCategory, filterBrand, filterDeviceOrigin],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterCategory) params.set('category', filterCategory);
      if (filterBrand) params.set('brand', filterBrand);
      if (filterDeviceOrigin) params.set('deviceOrigin', filterDeviceOrigin);
      const { data } = await api.get(`/pricing-templates?${params}`);
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        storage: form.storage || undefined,
        hasWarranty: form.category === 'PHONE_USED' ? (form.hasWarranty ?? false) : false,
        cashPrice: parseFloat(form.cashPrice),
        installmentBestchoicePrice: parseFloat(form.installmentBestchoicePrice),
        installmentFinancePrice: parseFloat(form.installmentFinancePrice),
      };
      if (editId) {
        const { data } = await api.put(`/pricing-templates/${editId}`, {
          cashPrice: payload.cashPrice,
          installmentBestchoicePrice: payload.installmentBestchoicePrice,
          installmentFinancePrice: payload.installmentFinancePrice,
          rate1DownPayment: form.rate1DownPayment ?? null,
          rate1TermMonths: form.rate1TermMonths ?? null,
          rate2TermMonths: form.rate2TermMonths ?? null,
        });
        return data;
      }
      const { data } = await api.post('/pricing-templates', payload);
      return data;
    },
    onSuccess: () => {
      toast.success(editId ? 'อัปเดตราคาสำเร็จ' : 'เพิ่มราคาตั้งต้นสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['pricing-templates'] });
      closeModal();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/pricing-templates/${id}`); },
    onSuccess: () => {
      toast.success('ลบสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['pricing-templates'] });
    },
    onError: () => toast.error('ลบไม่สำเร็จ'),
  });

  const importMutation = useMutation({
    mutationFn: ({ items, deactivateIds }: { items: PricingImportItem[]; deactivateIds: string[] }) =>
      sendPricingImport(
        async (body) => (await api.post('/pricing-templates/import', body)).data,
        items,
        deactivateIds,
        (done, total) => setImportProgress(`กำลังนำเข้า ชุด ${done}/${total}`),
      ),
    onSuccess: ({ saved, deactivated }) => {
      queryClient.invalidateQueries({ queryKey: ['pricing-templates'] });
      toast.success(deactivated > 0 ? `นำเข้าแล้ว ${saved} แถว · ปิด ${deactivated} แถว` : `นำเข้าแล้ว ${saved} แถว`);
      setReview(null);
    },
    onError: (err: unknown) => {
      queryClient.invalidateQueries({ queryKey: ['pricing-templates'] });
      toast.error(err instanceof ImportBatchError ? err.message : getErrorMessage(err));
    },
    onSettled: () => setImportProgress(null),
  });

  const downloadTemplate = async () => {
    // Dynamic import — keeps exceljs out of the page's initial chunk
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();

    const ws = wb.addWorksheet('ราคาตั้งต้น');
    ws.columns = PRICING_IMPORT_HEADERS.map((header) => ({ header, key: header, width: Math.max(10, header.length + 4) }));
    const sample = (
      model: string, storage: string, category: string, warranty: string,
      cash: number, bc: number, finance: number, term1: number, down1: number | null, term2: number | null,
    ) => ({
      'ยี่ห้อ': 'Apple', 'รุ่น': model, 'ความจุ': storage, 'เครื่องไทย/นอก': '', 'ประเภท': category, 'ประกัน': warranty,
      'ราคาเงินสด': cash, 'ราคาผ่อน BESTCHOICE (ราคาเต็ม)': bc, 'ราคาขาย GFIN (ราคาเต็ม)': finance,
      'งวดเรท 1': term1, 'ดาวน์เรท 1': down1, 'งวดเรท 2': term2,
    });
    ws.addRows([
      sample('iPhone 15', '128GB', 'มือ 1', '', 25900, 25900, 25900, 12, null, null),
      sample('iPhone 18 Pro', '256GB', 'มือ 1', '', 48900, 48900, 48900, 12, 18000, 15),
      sample('iPhone 13', '128GB', 'มือ 2', 'มีประกัน', 12500, 10200, 9600, 12, null, null),
      sample('iPhone 13', '128GB', 'มือ 2', 'ไม่มีประกัน', 12500, 10200, 9600, 12, null, null),
    ]);

    const wsInstr = wb.addWorksheet('คำอธิบาย');
    wsInstr.columns = [{ width: 30 }, { width: 70 }];
    wsInstr.addRows([
      ['คำอธิบายคอลัมน์', ''],
      ['ยี่ห้อ', 'ชื่อยี่ห้อ เช่น Apple'],
      ['รุ่น', 'ชื่อรุ่นให้ตรงรายชื่อรุ่นในโปรแกรม เช่น iPhone 15 Pro Max'],
      ['ความจุ', 'เช่น 128GB, 1TB · เว้นว่าง = ทุกความจุ'],
      ['เครื่องไทย/นอก', 'เครื่องไทย หรือ เครื่องนอก · เว้นว่าง = ไม่ระบุ (ใช้เมื่อไม่มีแถวของเครื่องไทย/นอก)'],
      ['ประเภท', '"มือ 1" หรือ "มือ 2"'],
      ['ประกัน', 'มือ 2: "มีประกัน" หรือ "ไม่มีประกัน" · มือ 1 เว้นว่าง'],
      ['ราคาเงินสด', 'ตัวเลข'],
      ['ราคาผ่อน BESTCHOICE (ราคาเต็ม)', 'ราคาเต็มที่ใช้คิดผ่อนกับร้าน (ไม่ใช่ค่างวด)'],
      ['ราคาขาย GFIN (ราคาเต็ม)', 'ราคาขายเมื่อผ่อนกับ GFIN (ไม่ใช่ค่างวด)'],
      ['งวดเรท 1', 'จำนวนงวดผ่อนกับร้าน · เว้นว่าง = 12 งวด (ถ้าตั้งค่าดอกเบี้ยไม่มี 12 ใช้งวดแรกที่มี)'],
      ['ดาวน์เรท 1', 'ดาวน์ผ่อนกับร้านเป็นบาท · เว้นว่าง = ดาวน์ขั้นต่ำปัดขึ้นหลักร้อย'],
      ['งวดเรท 2', 'จำนวนงวด GFIN · เว้นว่าง = งวดสูงสุดตามกติกา OVER'],
      [],
      ['หมายเหตุ', ''],
      ['- แถวที่ ยี่ห้อ+รุ่น+ความจุ+ประเภท+ประกัน+เครื่องไทย/นอก ตรงกับของเดิม จะแก้ทับ (ช่องที่เว้นว่างจะถูกล้าง)', ''],
      ['- ก่อนบันทึกจะมีหน้าตรวจ: เพิ่ม / แก้ / ข้าม พร้อมเหตุผล', ''],
    ]);

    const buffer = await wb.xlsx.writeBuffer();
    downloadExcelBuffer(buffer, 'แบบฟอร์มราคาตั้งต้น.xlsx');
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    let rows: Record<string, unknown>[];
    try {
      rows = await importFromExcel(file);
    } catch {
      toast.error('ไม่สามารถอ่านไฟล์ได้ กรุณาใช้ไฟล์ .xlsx');
      return;
    }
    if (rows.length === 0) {
      toast.error('ไฟล์ไม่มีข้อมูล');
      return;
    }
    try {
      // เทียบกับแถวที่เปิดใช้อยู่ทั้งหมด (ไม่ใช้ตัวกรองของหน้า)
      const { data: current } = await api.get<ExistingPricingTemplate[]>('/pricing-templates');
      const next = buildPricingImportReview(rows, current);
      if (next.rows.length === 0) {
        toast.error('ไม่พบข้อมูลที่ถูกต้อง กรุณาตรวจสอบหัวคอลัมน์');
        return;
      }
      setReview(next);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const openCreate = () => {
    setEditId(null);
    setForm(defaultForm);
    setShowModal(true);
  };

  const openEdit = (t: PricingTemplate) => {
    setEditId(t.id);
    setForm({
      brand: t.brand,
      model: t.model,
      storage: t.storage || '',
      category: t.category,
      deviceOrigin: t.deviceOrigin ?? 'UNSPECIFIED',
      hasWarranty: t.hasWarranty,
      cashPrice: t.cashPrice,
      installmentBestchoicePrice: t.installmentBestchoicePrice,
      installmentFinancePrice: t.installmentFinancePrice,
      rate1DownPayment: t.rate1DownPayment != null ? Number(t.rate1DownPayment) : undefined,
      rate1TermMonths: t.rate1TermMonths ?? undefined,
      rate2DownPayment: t.rate2DownPayment ?? undefined,
      rate2TermMonths: t.rate2TermMonths ?? undefined,
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditId(null);
    setForm(defaultForm);
  };

  const fmt = (v: string) => parseFloat(v).toLocaleString();

  const warrantyLabel = (hw: boolean | null) => {
    if (hw === true) return 'มีประกัน';
    if (hw === false) return 'ไม่มีประกัน';
    return null;
  };

  const canSave = form.brand && form.model && form.cashPrice && form.installmentBestchoicePrice && form.installmentFinancePrice
    && (form.category !== 'PHONE_USED' || form.hasWarranty !== null);

  return (
    <div>
      <PageHeader
        title="ราคาตั้งต้น"
        subtitle="ราคาเงินสด / ราคาผ่อน BESTCHOICE / ราคาขาย GFIN (ราคาเต็มทั้งสองช่อง) และงวด/ดาวน์ ตามรุ่นสินค้า"
        action={
          <div className="flex flex-wrap gap-2">
            <button data-ui-control="button"
              onClick={downloadTemplate}
              className="px-3 py-2 text-sm whitespace-nowrap text-muted-foreground border border-input rounded-lg hover:bg-muted/50"
            >
              ดาวน์โหลดแบบฟอร์ม
            </button>
            <button data-ui-control="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={importMutation.isPending}
              className="px-3 py-2 text-sm whitespace-nowrap text-primary border border-primary/30 rounded-lg hover:bg-primary/5 dark:hover:bg-primary/10 disabled:opacity-50"
            >
              {importMutation.isPending ? 'กำลังนำเข้า...' : 'นำเข้า Excel'}
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileImport} />
            <button data-ui-control="button" onClick={openCreate} className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium whitespace-nowrap rounded-lg hover:bg-primary/90">
              + เพิ่มราคาตั้งต้น
            </button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <NativeSelect wrapperClassName="max-w-full w-auto" aria-label="เครื่องไทย / เครื่องนอก" value={filterDeviceOrigin} onChange={e => setFilterDeviceOrigin(e.target.value)}>
          <option value="">ไทย/นอกทั้งหมด</option><option value="THAI">เครื่องไทย</option><option value="IMPORTED">เครื่องนอก</option><option value="UNSPECIFIED">ยังไม่ระบุ</option>
        </NativeSelect>
        <NativeSelect wrapperClassName="max-w-full w-auto" aria-label="ประเภทสินค้า"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="">ทุกประเภท</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </NativeSelect>
        <input aria-label="ค้นหายี่ห้อ"
          type="text"
          placeholder="ค้นหายี่ห้อ..."
          value={filterBrand}
          onChange={(e) => setFilterBrand(e.target.value)}
          className={cn(formControlClass, 'flex-1 max-w-xs')}
        />
      </div>

      <QueryBoundary
        isLoading={isLoading && templates.length === 0}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดราคาตั้งต้นได้"
      >
      {templates.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-border/50 bg-card shadow-sm">
          <div className="text-muted-foreground text-sm mb-3">ยังไม่มีราคาตั้งต้น</div>
          {/* hit area 44px mobile / 32px desktop; negative margins keep the empty state's height */}
          <button onClick={openCreate} className="inline-flex items-center text-sm text-primary hover:underline max-lg:min-h-11 lg:min-h-8 max-lg:-my-3 lg:-my-1.5">เพิ่มราคาตั้งต้นรายการแรก</button>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
          <div className="overflow-x-auto">
            <ScreenTable className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">ยี่ห้อ / รุ่น</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">ความจุ</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">ประเภท</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">เงินสด</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">ราคาผ่อน BESTCHOICE (ราคาเต็ม)</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">ราคาขาย GFIN (ราคาเต็ม)</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">งวด / ดาวน์</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{t.brand} {t.model}</div>
                      <div className="text-xs text-muted-foreground">{t.deviceOrigin === 'THAI' ? 'เครื่องไทย' : t.deviceOrigin === 'IMPORTED' ? 'เครื่องนอก' : 'ยังไม่แยกไทย/นอก'}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{t.storage || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        t.category === 'PHONE_NEW' ? 'bg-primary/10 text-primary dark:bg-primary/15' : 'bg-warning/10 text-warning-strong dark:bg-warning/15'
                      }`}>
                        {t.category === 'PHONE_NEW' ? 'มือ 1' : 'มือ 2'}
                      </span>
                      {t.category === 'PHONE_USED' && warrantyLabel(t.hasWarranty) && (
                        <span className={`ml-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          t.hasWarranty ? 'bg-success/10 text-success dark:bg-success/15' : 'bg-muted text-muted-foreground'
                        }`}>
                          {warrantyLabel(t.hasWarranty)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{fmt(t.cashPrice)} ฿</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{fmt(t.installmentBestchoicePrice)} ฿</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{fmt(t.installmentFinancePrice)} ฿</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground leading-snug">
                      <div>
                        เรท 1: {t.rate1TermMonths ? `${t.rate1TermMonths} งวด` : 'งวดตั้งต้น'} ·{' '}
                        {t.rate1DownPayment != null ? `ดาวน์ ${fmt(String(t.rate1DownPayment))}` : 'ดาวน์ขั้นต่ำ'}
                      </div>
                      <div>เรท 2: {t.rate2TermMonths ? `${t.rate2TermMonths} งวด` : 'งวดสูงสุดของ GFIN'}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEdit(t)} className="text-xs text-primary hover:underline mr-2">แก้ไข</button>
                      <button
                        onClick={() => setConfirmDialog({ open: true, message: 'ต้องการลบ?', action: () => deleteMutation.mutate(t.id) })}
                        className="text-xs text-destructive hover:underline"
                      >
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </ScreenTable>
          </div>
          </CardContent>
        </Card>
      )}
      </QueryBoundary>

      {/* Create/Edit Modal */}
      {showModal && (
        <Modal isOpen title={editId ? 'แก้ไขราคาตั้งต้น' : 'เพิ่มราคาตั้งต้น'} onClose={closeModal}>
          <div className="space-y-4">
            <label className="block text-sm">ประเภทเครื่องของราคากลาง
              <NativeSelect wrapperClassName="max-w-full w-full" aria-label="ประเภทเครื่องของราคากลาง" value={form.deviceOrigin} disabled={!!editId} onChange={(e) => setForm((f) => ({ ...f, deviceOrigin: e.target.value }))}>
                <option value="UNSPECIFIED">ยังไม่แยกไทย/นอก</option><option value="THAI">เครื่องไทย</option><option value="IMPORTED">เครื่องนอก</option>
              </NativeSelect>
            </label>
            {!editId && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={`${uiFieldId}-1`} className="block text-sm font-medium text-foreground mb-1">ยี่ห้อ *</label>
                    <input id={`${uiFieldId}-1`}
                      type="text"
                      value={form.brand}
                      onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                      placeholder="เช่น Apple, Samsung"
                      className={formControlClass}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${uiFieldId}-2`} className="block text-sm font-medium text-foreground mb-1">รุ่น *</label>
                    <input id={`${uiFieldId}-2`}
                      type="text"
                      value={form.model}
                      onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                      placeholder="เช่น iPhone 15, Galaxy S24"
                      className={formControlClass}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={`${uiFieldId}-3`} className="block text-sm font-medium text-foreground mb-1">ความจุ</label>
                    <input id={`${uiFieldId}-3`}
                      type="text"
                      value={form.storage}
                      onChange={(e) => setForm((f) => ({ ...f, storage: e.target.value }))}
                      placeholder="เช่น 128GB, 256GB (เว้นว่าง = ทุกความจุ)"
                      className={formControlClass}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${uiFieldId}-4`} className="block text-sm font-medium text-foreground mb-1">ประเภท *</label>
                    <NativeSelect wrapperClassName="max-w-full w-full" id={`${uiFieldId}-4`}
                      value={form.category}
                      onChange={(e) => setForm((f) => ({ ...f, category: e.target.value, hasWarranty: e.target.value === 'PHONE_USED' ? f.hasWarranty : null }))}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </NativeSelect>
                  </div>
                </div>
                {form.category === 'PHONE_USED' && (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">ประกันศูนย์</label>
                    <div className="flex gap-2">
                      {[
                        { value: true, label: 'มีประกัน' },
                        { value: false, label: 'ไม่มีประกัน' },
                      ].map((opt) => (
                        <button data-ui-control="button"
                          key={String(opt.value)}
                          onClick={() => setForm((f) => ({ ...f, hasWarranty: opt.value }))}
                          className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                            form.hasWarranty === opt.value
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-card text-foreground border-input hover:border-primary/50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {editId && (
              <div className="bg-muted rounded-lg p-3">
                <div className="text-sm font-medium text-foreground">
                  {form.brand} {form.model} {form.storage && `(${form.storage})`}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {form.category === 'PHONE_NEW' ? 'มือ 1' : 'มือ 2'}
                  {form.hasWarranty === true && ' - มีประกัน'}
                  {form.hasWarranty === false && ' - ไม่มีประกัน'}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label htmlFor={`${uiFieldId}-5`} className="block text-sm font-medium text-foreground mb-1">ราคาเงินสด (บาท) *</label>
                <NumberInput unstyled id={`${uiFieldId}-5`}
                  value={form.cashPrice}
                  onChange={(e) => setForm((f) => ({ ...f, cashPrice: e.target.value }))}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                  min="0"
                />
              </div>
              <div>
                <label htmlFor={`${uiFieldId}-6`} className="block text-sm font-medium text-foreground mb-1">ราคาผ่อน BESTCHOICE (ราคาเต็ม, บาท) *</label>
                <NumberInput unstyled id={`${uiFieldId}-6`}
                  value={form.installmentBestchoicePrice}
                  onChange={(e) => setForm((f) => ({ ...f, installmentBestchoicePrice: e.target.value }))}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                  min="0"
                />
              </div>
              <div>
                <label htmlFor={`${uiFieldId}-7`} className="block text-sm font-medium text-foreground mb-1">ราคาขาย GFIN (ราคาเต็ม, บาท) *</label>
                <NumberInput unstyled id={`${uiFieldId}-7`}
                  value={form.installmentFinancePrice}
                  onChange={(e) => setForm((f) => ({ ...f, installmentFinancePrice: e.target.value }))}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                  min="0"
                />
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-border/40">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                งวด / ดาวน์ของรุ่นนี้ (เว้นว่าง = ใช้กติกาตั้งต้น)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`${uiFieldId}-8`} className="block text-sm font-medium text-foreground mb-1">ดาวน์เรท 1 (บาท · ว่าง = ขั้นต่ำปัดขึ้นหลักร้อย)</label>
                  <NumberInput unstyled id={`${uiFieldId}-8`}
                    min={0}
                    value={form.rate1DownPayment ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, rate1DownPayment: e.target.value === '' ? undefined : Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label htmlFor={`${uiFieldId}-9`} className="block text-sm font-medium text-foreground mb-1">งวดเรท 1 (ว่าง = 12 งวด)</label>
                  <NumberInput unstyled id={`${uiFieldId}-9`}
                    min={1}
                    value={form.rate1TermMonths ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, rate1TermMonths: e.target.value === '' ? undefined : Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label htmlFor={`${uiFieldId}-11`} className="block text-sm font-medium text-foreground mb-1">งวดเรท 2 (ว่าง = งวดสูงสุดของ GFIN)</label>
                  <NumberInput unstyled id={`${uiFieldId}-11`}
                    min={1}
                    value={form.rate2TermMonths ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, rate2TermMonths: e.target.value === '' ? undefined : Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button data-ui-control="button" onClick={closeModal} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
              <button data-ui-control="button"
                onClick={() => saveMutation.mutate()}
                disabled={!canSave || saveMutation.isPending}
                className="flex-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {review && (
        <ImportReviewDialog
          title="ตรวจไฟล์ราคากลางก่อนนำเข้า"
          rows={review.rows}
          deactivateCount={review.missingActive.length}
          pending={importMutation.isPending}
          progress={importProgress}
          onCancel={() => setReview(null)}
          onConfirm={({ deactivateMissing }) =>
            importMutation.mutate({
              items: review.toSend,
              deactivateIds: deactivateMissing ? review.missingActive.map((t) => t.id) : [],
            })
          }
        />
      )}

      <ConfirmDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))} description={confirmDialog.message} variant="destructive" onConfirm={confirmDialog.action} />
    </div>
  );
}
