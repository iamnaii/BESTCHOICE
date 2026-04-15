import { useState, useEffect } from 'react';

// ── Shared interfaces ──

export interface ConfigItem {
  id: string;
  key: string;
  value: string;
  label: string | null;
}

export interface ConfigGroupItem {
  key: string;
  label: string;
  suffix: string;
  type: string;
  step: string;
  shortLabel: string;
  desc: string;
}

export interface ConfigGroup {
  key: string;
  title: string;
  subtitle: string;
  items: ConfigGroupItem[];
}

// ── Shared config data ──

export const configGroups: ConfigGroup[] = [
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

// ── StatCard: mini-card for displaying a single value ──

export function StatCard({
  label,
  value,
  suffix,
  desc,
}: {
  label: string;
  value: string;
  suffix: string;
  desc: string;
}) {
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

export function EditField({
  item,
  value,
  onChange,
}: {
  item: ConfigGroupItem;
  value: string;
  onChange: (val: string) => void;
}) {
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
            className={`w-full px-3 py-2 border border-input rounded-lg text-sm ${isAddress ? '' : 'text-right'} focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden`}
          />
        </div>
      </div>
      {item.desc && <div className="text-xs text-muted-foreground/70 mt-1 ml-0.5">{item.desc}</div>}
    </div>
  );
}

// ── SettingsCard: reusable card with view/edit modes ──

export function SettingsCard({
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
  renderEdit?: (
    draft: Record<string, string>,
    setDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    group: ConfigGroup,
  ) => React.ReactNode;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isEditing) {
      const d: Record<string, string> = {};
      group.items.forEach((item) => {
        d[item.key] = values[item.key] ?? '';
      });
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
              <button onClick={onEdit} className="text-xs text-primary hover:underline px-2 py-1 shrink-0">
                แก้ไข
              </button>
            )}
          </div>

          {!isEditing ? (
            <div className="mt-4">
              {renderView ? (
                renderView(values, group)
              ) : (
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
              {renderEdit ? (
                renderEdit(draft, setDraft, group)
              ) : (
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
