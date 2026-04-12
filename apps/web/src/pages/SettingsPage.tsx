import { useState, useEffect, useCallback, useRef } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { checkCardReaderStatus, type CardReaderStatus } from '@/lib/cardReader';

interface ConfigItem {
  id: string;
  key: string;
  value: string;
  label: string | null;
}

interface ConfigGroupItem {
  key: string;
  label: string;
  suffix: string;
  type: string;
  step: string;
  shortLabel: string;
  desc: string;
}

interface ConfigGroup {
  key: string;
  title: string;
  subtitle: string;
  items: ConfigGroupItem[];
}

const configGroups: ConfigGroup[] = [
  {
    key: 'penalty',
    title: 'ค่าปรับ จำนวนงวด และการติดตามหนี้',
    subtitle: 'กำหนดค่าปรับ จำนวนงวด และเกณฑ์ติดตามหนี้สำหรับสัญญาผ่อนชำระ',
    items: [
      { key: 'late_fee_per_day', label: 'ค่าปรับจ่ายช้าต่อวัน (บาท)', shortLabel: 'ค่าปรับ/วัน', suffix: ' บาท', type: 'number', step: '1', desc: 'เรียกเก็บต่อวันเมื่อลูกค้าจ่ายช้า' },
      { key: 'late_fee_cap', label: 'ค่าปรับสูงสุดต่องวด (บาท)', shortLabel: 'ค่าปรับสูงสุด', suffix: ' บาท', type: 'number', step: '1', desc: 'เพดานค่าปรับสูงสุดต่อ 1 งวด' },
      { key: 'early_payoff_discount', label: 'ส่วนลดปิดบัญชีก่อนกำหนด (%)', shortLabel: 'ส่วนลดปิดก่อน', suffix: '', type: 'number', step: '0.1', desc: 'ลดให้ลูกค้าที่ปิดบัญชีก่อนกำหนด' },
      { key: 'min_installment_months', label: 'จำนวนงวดขั้นต่ำ (เดือน)', shortLabel: 'งวดขั้นต่ำ', suffix: ' เดือน', type: 'number', step: '1', desc: 'จำนวนงวดต่ำสุดที่เลือกได้' },
      { key: 'max_installment_months', label: 'จำนวนงวดสูงสุด (เดือน)', shortLabel: 'งวดสูงสุด', suffix: ' เดือน', type: 'number', step: '1', desc: 'จำนวนงวดสูงสุดที่เลือกได้' },
      { key: 'overdue_days_threshold', label: 'จำนวนวันก่อนเปลี่ยนสถานะ OVERDUE', shortLabel: 'เกณฑ์ OVERDUE', suffix: ' วัน', type: 'number', step: '1', desc: 'ค้างกี่วันถึงเปลี่ยนสถานะเป็น OVERDUE' },
    ],
  },
  {
    key: 'pdpa',
    title: 'PDPA และความปลอดภัย',
    subtitle: 'ตั้งค่าเวอร์ชัน PDPA และความปลอดภัยของ Link เอกสาร',
    items: [
      { key: 'pdpa_privacy_notice_version', label: 'เวอร์ชัน Privacy Notice (PDPA)', shortLabel: 'PDPA Version', suffix: '', type: 'text', step: '', desc: 'เลขเวอร์ชัน Privacy Notice ที่ลูกค้ายอมรับ' },
      { key: 'customer_access_token_hours', label: 'อายุ Link เอกสารลูกค้า (ชั่วโมง)', shortLabel: 'อายุ Link', suffix: ' ชม.', type: 'number', step: '1', desc: 'Link เอกสารหมดอายุหลังกี่ชั่วโมง' },
    ],
  },
  {
    key: 'company',
    title: 'ข้อมูลบริษัทและสัญญา',
    subtitle: 'ข้อมูลบริษัท ค่าคงที่สัญญา และลายเซ็นที่ใช้พิมพ์ในเอกสาร',
    items: [
      { key: 'company_name_th', label: 'ชื่อบริษัท (ไทย)', shortLabel: 'ชื่อบริษัท (ไทย)', suffix: '', type: 'text', step: '', desc: 'ใช้พิมพ์ในสัญญาและเอกสาร' },
      { key: 'company_name_en', label: 'ชื่อบริษัท (อังกฤษ)', shortLabel: 'ชื่อบริษัท (EN)', suffix: '', type: 'text', step: '', desc: 'ใช้พิมพ์ในสัญญาภาษาอังกฤษ' },
      { key: 'company_tax_id', label: 'เลขประจำตัวผู้เสียภาษี', shortLabel: 'เลขผู้เสียภาษี', suffix: '', type: 'text', step: '', desc: 'เลข 13 หลัก ใช้ในใบเสร็จและสัญญา' },
      { key: 'company_address', label: 'ที่อยู่บริษัท', shortLabel: 'ที่อยู่', suffix: '', type: 'text', step: '', desc: 'ที่อยู่จดทะเบียน ใช้ในเอกสารราชการ' },
      { key: 'company_director', label: 'ชื่อกรรมการผู้จัดการ', shortLabel: 'กรรมการ', suffix: '', type: 'text', step: '', desc: 'ผู้มีอำนาจลงนามในสัญญา' },
      { key: 'company_director_id', label: 'เลขบัตรกรรมการ', shortLabel: 'เลขบัตรกรรมการ', suffix: '', type: 'text', step: '', desc: 'เลขบัตรประชาชนกรรมการ ใช้ในสัญญา' },
      { key: 'company_director_address', label: 'ที่อยู่กรรมการ', shortLabel: 'ที่อยู่กรรมการ', suffix: '', type: 'text', step: '', desc: 'ที่อยู่ตามบัตรประชาชนกรรมการ' },
      { key: 'contract_penalty_rate', label: 'ค่าปรับล่าช้า (บาท/วัน)', shortLabel: 'ค่าปรับสัญญา', suffix: ' บาท', type: 'number', step: '1', desc: 'พิมพ์เป็นค่าปรับในเทมเพลตสัญญา' },
      { key: 'contract_warranty_days', label: 'ระยะเวลารับประกัน (วัน)', shortLabel: 'รับประกัน', suffix: ' วัน', type: 'number', step: '1', desc: 'ระยะรับประกันสินค้าในสัญญา' },
      { key: 'contract_early_discount', label: 'ส่วนลดปิดก่อนกำหนด (%)', shortLabel: 'ส่วนลดปิดก่อน', suffix: '%', type: 'number', step: '1', desc: 'พิมพ์เป็นส่วนลดในเทมเพลตสัญญา' },
      { key: 'contract_min_months_early', label: 'งวดขั้นต่ำก่อนปิดก่อนกำหนด', shortLabel: 'งวดขั้นต่ำปิดก่อน', suffix: ' งวด', type: 'number', step: '1', desc: 'ผ่อนครบกี่งวดถึงปิดก่อนกำหนดได้' },
    ],
  },
  {
    key: 'banking',
    title: 'บัญชีธนาคาร (สำหรับโอนเงิน)',
    subtitle: 'ข้อมูลบัญชีธนาคารที่แสดงให้ลูกค้าเมื่อเลือกโอนเงิน',
    items: [
      { key: 'bank_name', label: 'ชื่อธนาคาร', shortLabel: 'ธนาคาร', suffix: '', type: 'text', step: '', desc: 'เช่น กสิกรไทย, กรุงเทพ, ไทยพาณิชย์' },
      { key: 'bank_account_number', label: 'เลขที่บัญชี', shortLabel: 'เลขบัญชี', suffix: '', type: 'text', step: '', desc: 'เลขบัญชีธนาคาร 10-12 หลัก' },
      { key: 'bank_account_name', label: 'ชื่อบัญชี', shortLabel: 'ชื่อบัญชี', suffix: '', type: 'text', step: '', desc: 'ชื่อเจ้าของบัญชีตามหน้าบุ๊คแบงก์' },
    ],
  },
  {
    key: 'payment_link',
    title: 'Payment Gateway',
    subtitle: 'ตั้งค่าลิงก์ชำระเงิน (ชำระผ่าน PaySolutions)',
    items: [
      { key: 'payment_link_expiry_hours', label: 'อายุลิงก์ชำระเงิน (ชั่วโมง)', shortLabel: 'อายุ Link', suffix: ' ชม.', type: 'number', step: '1', desc: 'ลิงก์ชำระเงินหมดอายุหลังกี่ชั่วโมง' },
    ],
  },
];

const CARD_READER_DOWNLOAD_URL = 'https://github.com/iamnaii/BESTCHOICE/releases/latest/download/BestchoiceCardReader.zip';

// ── StatCard: mini-card for displaying a single value ──

function StatCard({ label, value, suffix, desc }: { label: string; value: string; suffix: string; desc: string }) {
  const display = value ? `${value}${suffix}` : '-';
  return (
    <div className="bg-muted rounded-xl p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold text-foreground mt-0.5">{display}</div>
      {desc && <div className="text-xs text-muted-foreground/70 mt-1">{desc}</div>}
    </div>
  );
}

// ── EditField: input with description ──

function EditField({ item, value, onChange }: { item: ConfigGroupItem; value: string; onChange: (val: string) => void }) {
  const isAddress = item.key.includes('ADDRESS');
  return (
    <div>
      <div className={`flex ${isAddress ? 'flex-col gap-1' : 'items-center gap-4'}`}>
        <label className={`${isAddress ? '' : 'flex-1'} text-sm text-foreground`}>{item.label}</label>
        <div className={isAddress ? 'w-full' : 'w-48'}>
          <input
            type={item.type}
            step={item.step}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`w-full px-3 py-2 border border-input rounded-lg text-sm ${isAddress ? '' : 'text-right'} focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none`}
          />
        </div>
      </div>
      {item.desc && <div className="text-xs text-muted-foreground/70 mt-1 ml-0.5">{item.desc}</div>}
    </div>
  );
}

// ── SettingsCard: reusable card with view/edit modes ──

function SettingsCard({
  group,
  values,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  isSaving,
  renderView,
  renderEdit,
}: {
  group: ConfigGroup;
  values: Record<string, string>;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (items: { key: string; value: string }[]) => void;
  onCancel: () => void;
  isSaving: boolean;
  renderView?: (values: Record<string, string>, group: ConfigGroup) => React.ReactNode;
  renderEdit?: (draft: Record<string, string>, setDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>, group: ConfigGroup) => React.ReactNode;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isEditing) {
      const d: Record<string, string> = {};
      group.items.forEach((item) => { d[item.key] = values[item.key] ?? ''; });
      setDraft(d);
    }
  }, [isEditing]);

  const handleSave = () => {
    const items = group.items.map((item) => ({ key: item.key, value: draft[item.key] ?? '' }));
    onSave(items);
  };

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
      <div className="flex">
        <div className="w-1 shrink-0 bg-primary" />
      <div className="p-5 flex-1">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-bold text-foreground">{group.title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{group.subtitle}</p>
        </div>
        {!isEditing && (
          <button onClick={onEdit} className="text-xs text-primary hover:underline px-2 py-1 shrink-0">แก้ไข</button>
        )}
      </div>

      {!isEditing ? (
        <div className="mt-4">
          {renderView ? renderView(values, group) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {group.items.map((item) => (
                <StatCard
                  key={item.key}
                  label={item.shortLabel}
                  value={values[item.key] || ''}
                  suffix={item.suffix}
                  desc={item.desc}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {renderEdit ? renderEdit(draft, setDraft, group) : (
            group.items.map((item) => (
              <EditField
                key={item.key}
                item={item}
                value={draft[item.key] ?? ''}
                onChange={(val) => setDraft((prev) => ({ ...prev, [item.key]: val }))}
              />
            ))
          )}
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {isSaving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            <button onClick={onCancel} className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
              ยกเลิก
            </button>
          </div>
        </div>
      )}
      </div>
      </div>
    </div>
  );
}

// ── CardReaderSetup ──

function CardReaderSetup() {
  const [status, setStatus] = useState<CardReaderStatus | null | 'checking'>('checking');

  const checkStatus = useCallback(async () => {
    setStatus('checking');
    const result = await checkCardReaderStatus();
    setStatus(result);
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  const isConnected = status !== null && status !== 'checking' && typeof status === 'object' && ['waiting', 'card_inserted', 'reading'].includes(status.status);
  const statusInfo = (() => {
    if (status === 'checking') return { color: 'gray', icon: '⏳', text: 'กำลังตรวจสอบ...' };
    if (status === null) return { color: 'red', icon: '❌', text: 'ยังไม่ได้ติดตั้ง หรือโปรแกรมไม่ได้เปิดอยู่' };
    switch (status.status) {
      case 'waiting': return { color: 'green', icon: '✅', text: `เชื่อมต่อแล้ว — ${status.readerName || 'รอเสียบบัตร'}` };
      case 'card_inserted': return { color: 'green', icon: '✅', text: 'พร้อมอ่านบัตร' };
      case 'reading': return { color: 'blue', icon: '📖', text: 'กำลังอ่านบัตร...' };
      case 'no_reader': return { color: 'yellow', icon: '⚠️', text: 'โปรแกรมทำงานอยู่ แต่ไม่พบเครื่องอ่านบัตร USB' };
      case 'no_pcsc': return { color: 'red', icon: '❌', text: 'ไม่พบ Smart Card Service บนเครื่อง' };
      case 'error': return { color: 'red', icon: '❌', text: status.error || 'เกิดข้อผิดพลาด' };
      default: return { color: 'gray', icon: '❓', text: 'ไม่ทราบสถานะ' };
    }
  })();

  const bgColor = { green: 'bg-success/5 dark:bg-success/10 border-success/20', yellow: 'bg-warning/5 dark:bg-warning/10 border-warning/20', red: 'bg-destructive/5 dark:bg-destructive/10 border-destructive/20', blue: 'bg-primary-50 border-primary-200', gray: 'bg-muted border-border' }[statusInfo.color] || 'bg-muted border-border';
  const textColor = { green: 'text-success', yellow: 'text-warning', red: 'text-destructive', blue: 'text-primary-700', gray: 'text-muted-foreground' }[statusInfo.color] || 'text-muted-foreground';

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" /></svg>
            เครื่องอ่านบัตรประชาชน
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            โปรแกรมสำหรับอ่านบัตรประชาชนผ่านเครื่องอ่านบัตร USB — ติดตั้งบนเครื่องคอมที่ร้าน
          </p>
          <div className={`mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm ${bgColor} ${textColor}`}>
            <span>{statusInfo.icon}</span>
            <span>{statusInfo.text}</span>
            <button onClick={checkStatus} className="ml-1 text-muted-foreground hover:text-foreground" title="ตรวจสอบใหม่">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
          </div>
          {!isConnected && (
            <div className="mt-4 text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">วิธีติดตั้ง:</p>
              <ol className="list-decimal list-inside space-y-0.5 ml-1">
                <li>กดปุ่ม <strong>"ดาวน์โหลด"</strong> ด้านขวา</li>
                <li>โหลดไฟล์ <code className="bg-muted px-1 rounded text-xs">.zip</code> → คลิกขวา → <strong>Extract All</strong></li>
                <li>เปิดโฟลเดอร์ → ดับเบิลคลิก <strong>setup.bat</strong></li>
                <li>เสร็จ! ดับเบิลคลิก <strong>"BESTCHOICE Card Reader"</strong> บน Desktop</li>
              </ol>
            </div>
          )}
        </div>
        <div className="flex flex-col items-center gap-2 shrink-0">
          <a
            href={CARD_READER_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-2 shadow-card"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            ดาวน์โหลด
          </a>
          <span className="text-xs text-muted-foreground">Windows 10+</span>
        </div>
      </div>
    </div>
  );
}

// ── SignatureEditor: canvas drawing for company card edit mode ──

function SignatureEditor({
  savedImage,
  savedName,
  signerName,
  onSignerNameChange,
  onSignatureDraw,
  onRemove,
}: {
  savedImage: string;
  savedName: string;
  signerName: string;
  onSignerNameChange: (name: string) => void;
  onSignatureDraw: (dataUrl: string) => void;
  onRemove: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);

  const setupCtx = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1a1a';
  }, []);

  useEffect(() => { if (showCanvas) setTimeout(setupCtx, 50); }, [showCanvas, setupCtx]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    }
    return { x: (e.nativeEvent.offsetX) * scaleX, y: (e.nativeEvent.offsetY) * scaleY };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const endDraw = () => setIsDrawing(false);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleConfirmDraw = () => {
    if (!hasDrawn) return;
    const dataUrl = canvasRef.current!.toDataURL('image/png');
    onSignatureDraw(dataUrl);
    setShowCanvas(false);
    setHasDrawn(false);
  };

  return (
    <div className="border-t border-border/60 pt-4 mt-2">
      <div className="text-sm font-medium text-foreground mb-1">ลายเซ็นผู้ให้เช่าซื้อ</div>
      <div className="text-xs text-muted-foreground/70 mb-3">ลายเซ็นนี้จะถูกใช้อัตโนมัติในทุกสัญญา ไม่ต้องเซ็นใหม่ทุกครั้ง</div>

      <div className="flex items-center gap-4 mb-3">
        <label className="flex-1 text-sm text-foreground">ชื่อผู้ให้เช่าซื้อ</label>
        <div className="w-48">
          <input
            type="text"
            value={signerName}
            onChange={(e) => onSignerNameChange(e.target.value)}
            placeholder="เช่น เอกนรินทร์ คงเดช"
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
          />
        </div>
      </div>

      {savedImage && !showCanvas ? (
        <div className="space-y-2">
          <div className="inline-flex items-center gap-3 border border-border rounded-lg p-3 bg-muted">
            <img src={savedImage} alt="ลายเซ็น" style={{ maxHeight: '60px' }} />
            <span className="text-xs text-muted-foreground">({savedName})</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowCanvas(true)} type="button" className="text-xs text-primary hover:underline">เปลี่ยนลายเซ็น</button>
            <button onClick={onRemove} type="button" className="text-xs text-red-600 hover:underline">ลบลายเซ็น</button>
          </div>
        </div>
      ) : !showCanvas ? (
        <button onClick={() => setShowCanvas(true)} type="button" className="text-xs text-primary hover:underline">
          วาดลายเซ็น
        </button>
      ) : (
        <div className="space-y-2">
          <div className="border-2 border-dashed border-input rounded-lg bg-card inline-block" style={{ touchAction: 'none' }}>
            <canvas
              ref={canvasRef}
              width={500}
              height={200}
              style={{ width: '100%', maxWidth: '500px', height: 'auto', aspectRatio: '5/2', cursor: 'crosshair' }}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleConfirmDraw} disabled={!hasDrawn} type="button" className="text-xs text-primary hover:underline disabled:opacity-50">
              ยืนยันลายเซ็น
            </button>
            <button onClick={clearCanvas} type="button" className="text-xs text-muted-foreground hover:text-foreground">ล้าง</button>
            <button onClick={() => { setShowCanvas(false); setHasDrawn(false); }} type="button" className="text-xs text-muted-foreground hover:text-foreground">ยกเลิก</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──

export default function SettingsPage() {
  useDocumentTitle('ตั้งค่า');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [editingSection, setEditingSection] = useState<string | null>(null);

  const [draftSignatureImage, setDraftSignatureImage] = useState('');
  const [draftSignerName, setDraftSignerName] = useState('');

  const { data: configs = [], isLoading } = useQuery<ConfigItem[]>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  useEffect(() => {
    if (configs.length > 0 && !editingSection) {
      const map: Record<string, string> = {};
      configs.forEach((c) => { map[c.key] = c.value; });
      setValues(map);
    }
  }, [configs]);

  const saveMutation = useMutation({
    mutationFn: async (items: { key: string; value: string }[]) =>
      api.patch('/settings', { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('บันทึกสำเร็จ');
      setEditingSection(null);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const handleEdit = (sectionKey: string) => {
    if (editingSection && editingSection !== sectionKey) {
      toast.error('กรุณาบันทึกหรือยกเลิกการแก้ไขก่อน');
      return;
    }
    setEditingSection(sectionKey);
    if (sectionKey === 'company') {
      setDraftSignatureImage(values['lessor_signature_image'] || '');
      setDraftSignerName(values['lessor_signer_name'] || '');
    }
  };

  const handleCancel = () => setEditingSection(null);

  const handleSave = (items: { key: string; value: string }[]) => {
    if (editingSection === 'company') {
      items = [
        ...items,
        { key: 'lessor_signature_image', value: draftSignatureImage },
        { key: 'lessor_signer_name', value: draftSignerName },
      ];
    }
    saveMutation.mutate(items);
    const updated = { ...values };
    items.forEach(({ key, value }) => { updated[key] = value; });
    setValues(updated);
  };

  // Company card: separate text fields from number fields
  const companyGroup = configGroups.find((g) => g.key === 'company')!;
  const companyTextItems = companyGroup.items.filter((i) => i.type === 'text');
  const companyNumberItems = companyGroup.items.filter((i) => i.type === 'number');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="ตั้งค่าระบบ"
        subtitle="กำหนดพารามิเตอร์การทำงานของระบบ"
      />

      <div className="flex flex-col gap-5 lg:gap-7.5">
        <CardReaderSetup />

        {/* Link to LINE OA Settings */}
        <div className="bg-success/5 dark:bg-success/10 border border-success/20 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-success">เชื่อมต่อ LINE OA</div>
            <div className="text-xs text-success mt-0.5">เชื่อมต่อ LINE Official Account เพื่อส่งแจ้งเตือนค่างวด, สลิปชำระเงิน และติดตามหนี้ผ่าน LINE</div>
          </div>
          <button onClick={() => navigate('/settings/line-oa')} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 whitespace-nowrap">
            ตั้งค่า LINE OA
          </button>
        </div>

        {/* Link to InterestConfig */}
        <div className="bg-primary-50 border border-primary-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-primary-800">ตั้งค่าอัตราดอกเบี้ยตามประเภทสินค้า</div>
            <div className="text-xs text-primary mt-0.5">ตั้งค่าดอกเบี้ย เงินดาวน์ขั้นต่ำ จำนวนงวด แยกตามประเภทสินค้า (มือ1, มือ2, แท็บเล็ต ฯลฯ)</div>
          </div>
          <button onClick={() => navigate('/settings/interest-config')} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 whitespace-nowrap">
            ตั้งค่าดอกเบี้ย
          </button>
        </div>

        {/* Link to SMS Settings */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-blue-800">ตั้งค่า SMS (ThaiBulkSMS)</div>
            <div className="text-xs text-blue-600 mt-0.5">เชื่อมต่อ ThaiBulkSMS เพื่อส่ง OTP ยืนยันตัวตน และแจ้งเตือนค่างวดผ่าน SMS</div>
          </div>
          <button onClick={() => navigate('/settings/sms')} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap">
            ตั้งค่า SMS
          </button>
        </div>

        {/* Config cards */}
        {configGroups.map((group) => (
          <SettingsCard
            key={group.key}
            group={group}
            values={values}
            isEditing={editingSection === group.key}
            onEdit={() => handleEdit(group.key)}
            onSave={handleSave}
            onCancel={handleCancel}
            isSaving={saveMutation.isPending}
            renderView={group.key === 'company' ? (vals) => (
              <>
                {/* Company info as key-value list */}
                <div className="space-y-2 mb-4">
                  {companyTextItems.map((item) => (
                    <div key={item.key} className="flex items-baseline gap-2">
                      <span className="text-xs text-muted-foreground w-36 shrink-0">{item.shortLabel}</span>
                      <span className="text-sm text-foreground">{vals[item.key] || <span className="text-muted-foreground">-</span>}</span>
                    </div>
                  ))}
                </div>

                {/* Contract number values as stat cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {companyNumberItems.map((item) => (
                    <StatCard
                      key={item.key}
                      label={item.shortLabel}
                      value={vals[item.key] || ''}
                      suffix={item.suffix}
                      desc={item.desc}
                    />
                  ))}
                </div>

                {/* Signature preview */}
                <div className="border-t border-border/60 pt-3">
                  <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ลายเซ็นผู้ให้เช่าซื้อ</div>
                  {vals['lessor_signature_image'] ? (
                    <div className="inline-flex items-center gap-3">
                      <img src={vals['lessor_signature_image']} alt="ลายเซ็น" style={{ maxHeight: '50px' }} />
                      <span className="text-sm text-foreground">({vals['lessor_signer_name']})</span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">ยังไม่ได้ตั้งค่า — กดแก้ไขเพื่อวาดลายเซ็น</span>
                  )}
                </div>
              </>
            ) : undefined}
            renderEdit={group.key === 'company' ? (draft, setDraft) => (
              <>
                {/* Company text fields */}
                <div className="text-sm font-medium text-foreground mb-2">ข้อมูลบริษัท</div>
                {companyTextItems.map((item) => (
                  <EditField
                    key={item.key}
                    item={item}
                    value={draft[item.key] ?? ''}
                    onChange={(val) => setDraft((prev) => ({ ...prev, [item.key]: val }))}
                  />
                ))}

                {/* Contract number fields */}
                <div className="text-sm font-medium text-foreground mt-4 mb-2">ค่าคงที่สัญญา</div>
                {companyNumberItems.map((item) => (
                  <EditField
                    key={item.key}
                    item={item}
                    value={draft[item.key] ?? ''}
                    onChange={(val) => setDraft((prev) => ({ ...prev, [item.key]: val }))}
                  />
                ))}

                {/* Signature editor */}
                <SignatureEditor
                  savedImage={draftSignatureImage}
                  savedName={draftSignerName}
                  signerName={draftSignerName}
                  onSignerNameChange={setDraftSignerName}
                  onSignatureDraw={setDraftSignatureImage}
                  onRemove={() => { setDraftSignatureImage(''); setDraftSignerName(''); }}
                />
              </>
            ) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
