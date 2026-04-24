import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bell,
  MessageSquare,
  Phone,
  Plus,
  Pencil,
  Trash2,
  ArrowRight,
  Link2,
  ToggleLeft,
  ToggleRight,
  FileSignature,
  Upload,
  Image as ImageIcon,
} from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getStatusBadgeProps, dunningChannelMap } from '@/lib/status-badges';

interface DunningRule {
  id: string;
  name: string;
  triggerDay: number | null;
  eventTrigger: string | null;
  channel: 'LINE' | 'SMS' | 'CALL_TASK' | 'INTERNAL_ALERT';
  messageTemplate: string;
  includePaymentLink: boolean;
  autoExecute: boolean;
  escalateTo: string | null;
  isActive: boolean;
  sortOrder: number;
}

type DunningChannel = DunningRule['channel'];

const CHANNEL_CONFIG: Record<
  DunningChannel,
  { icon: React.ComponentType<{ className?: string }> }
> = {
  LINE: { icon: MessageSquare },
  SMS: { icon: MessageSquare },
  CALL_TASK: { icon: Phone },
  INTERNAL_ALERT: { icon: Bell },
};

const CHANNEL_OPTIONS: { value: DunningChannel; label: string }[] = [
  { value: 'LINE', label: 'LINE' },
  { value: 'SMS', label: 'SMS' },
  { value: 'CALL_TASK', label: 'โทรติดตาม' },
  { value: 'INTERNAL_ALERT', label: 'แจ้งเตือนภายใน' },
];

const TEMPLATE_VARS = [
  { var: '{{customerName}}', desc: 'ชื่อลูกค้า' },
  { var: '{{contractNo}}', desc: 'เลขที่สัญญา' },
  { var: '{{daysOverdue}}', desc: 'จำนวนวันที่ค้าง' },
  { var: '{{amountDue}}', desc: 'ยอดที่ค้างชำระ' },
  { var: '{{paymentLink}}', desc: 'ลิงก์ชำระเงิน' },
];

const defaultForm = {
  name: '',
  triggerDay: 0,
  channel: 'LINE' as DunningChannel,
  messageTemplate: '',
  includePaymentLink: false,
  autoExecute: true,
  escalateTo: '',
  sortOrder: 0,
};

type FormState = typeof defaultForm;

function getTriggerLabel(day: number): string {
  if (day < 0) return `ก่อนครบกำหนด ${Math.abs(day)} วัน`;
  if (day === 0) return 'วันครบกำหนด';
  return `เกินกำหนด ${day} วัน`;
}

function getTriggerBadgeCls(day: number): string {
  if (day < 0) return 'bg-info/20 text-info border border-info/30';
  if (day === 0) return 'bg-warning/20 text-warning border border-warning/30';
  if (day <= 7) return 'bg-warning/30 text-warning border border-warning/40';
  if (day <= 30) return 'bg-destructive/20 text-destructive border border-destructive/30';
  return 'bg-destructive/30 text-destructive border border-destructive/40';
}

interface ConfigItem {
  key: string;
  value: string;
}

function LetterAssetField({
  label,
  hint,
  currentUrl,
  uploadKind,
  onSaved,
}: {
  label: string;
  hint: string;
  currentUrl: string;
  uploadKind: 'LETTER_SIGNATURE' | 'LETTER_LETTERHEAD';
  onSaved: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = async (file: File) => {
    setUploading(true);
    try {
      const { data: presigned } = await api.post('/shop/upload/signed-url', {
        kind: uploadKind,
        contentType: file.type,
      });
      const up = await fetch(presigned.uploadUrl, {
        method: presigned.method ?? 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!up.ok) throw new Error('Upload failed');
      onSaved(presigned.publicUrl);
      toast.success('อัปโหลดสำเร็จ');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="text-xs font-medium mb-1">{label}</div>
      <div className="text-xs text-muted-foreground mb-2">{hint}</div>
      <div className="flex items-center gap-3">
        {currentUrl ? (
          <div className="shrink-0 size-16 rounded-lg border border-border bg-muted/30 p-1 flex items-center justify-center overflow-hidden">
            <img src={currentUrl} alt={label} className="max-w-full max-h-full object-contain" />
          </div>
        ) : (
          <div className="shrink-0 size-16 rounded-lg border border-dashed border-border bg-muted/20 flex items-center justify-center">
            <ImageIcon className="size-5 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleChange(f);
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-input hover:bg-muted disabled:opacity-50"
          >
            <Upload className="size-3.5" />{' '}
            {uploading ? 'กำลังอัปโหลด...' : currentUrl ? 'เปลี่ยนรูป' : 'อัปโหลด'}
          </button>
          {currentUrl && (
            <button
              type="button"
              onClick={() => onSaved('')}
              className="ml-2 text-xs text-muted-foreground hover:text-destructive"
            >
              ลบ
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DunningSettingsPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    description: string;
    action: () => void;
  }>({ open: false, description: '', action: () => {} });

  const {
    data: rules = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<DunningRule[]>({
    queryKey: ['dunning-rules'],
    queryFn: async () => {
      const { data } = await api.get('/overdue/dunning-rules');
      return data;
    },
  });

  const timeBasedRules = rules.filter((r) => r.triggerDay !== null);
  const eventRules = rules.filter((r) => r.eventTrigger !== null);

  const sortedRules = [...timeBasedRules].sort(
    (a, b) => (a.triggerDay ?? 0) - (b.triggerDay ?? 0) || a.sortOrder - b.sortOrder,
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        escalateTo: form.escalateTo?.trim() || null,
      };
      if (editId) {
        const { data } = await api.patch(`/overdue/dunning-rules/${editId}`, payload);
        return data;
      }
      const { data } = await api.post('/overdue/dunning-rules', payload);
      return data;
    },
    onSuccess: () => {
      toast.success(editId ? 'อัปเดต Rule สำเร็จ' : 'เพิ่ม Rule สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['dunning-rules'] });
      closeModal();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/overdue/dunning-rules/${id}`);
    },
    onSuccess: () => {
      toast.success('ลบ Rule สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['dunning-rules'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { data } = await api.patch(`/overdue/dunning-rules/${id}`, { isActive });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dunning-rules'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const { data: configs = [] } = useQuery<ConfigItem[]>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  const signatureUrl = configs.find((s) => s.key === 'letter_signature_url')?.value ?? '';
  const letterheadUrl = configs.find((s) => s.key === 'letter_letterhead_url')?.value ?? '';

  const configMutation = useMutation({
    mutationFn: async (items: Array<{ key: string; value: string }>) =>
      (await api.patch('/settings', { items })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const saveConfig = (key: string, value: string) => configMutation.mutate([{ key, value }]);

  const openCreate = () => {
    setEditId(null);
    setForm(defaultForm);
    setShowModal(true);
  };

  const openEdit = (rule: DunningRule) => {
    setEditId(rule.id);
    setForm({
      name: rule.name,
      triggerDay: rule.triggerDay ?? 0,
      channel: rule.channel,
      messageTemplate: rule.messageTemplate,
      includePaymentLink: rule.includePaymentLink,
      autoExecute: rule.autoExecute,
      escalateTo: rule.escalateTo ?? '',
      sortOrder: rule.sortOrder,
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditId(null);
    setForm(defaultForm);
  };

  const handleDelete = (rule: DunningRule) => {
    setConfirmDialog({
      open: true,
      description: `ต้องการลบ Rule "${rule.name}" ใช่หรือไม่?`,
      action: () => deleteMutation.mutate(rule.id),
    });
  };

  const handleToggle = (rule: DunningRule) => {
    toggleMutation.mutate({ id: rule.id, isActive: !rule.isActive });
  };

  const handleFormChange = (key: keyof FormState, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const insertVar = (v: string) => {
    setForm((prev) => ({ ...prev, messageTemplate: prev.messageTemplate + v }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('กรุณาระบุชื่อ Rule');
      return;
    }
    saveMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="ตั้งค่าระบบทวงหนี้อัตโนมัติ"
        subtitle="กำหนด Rule การแจ้งเตือนและทวงหนี้ลูกค้าตามจำนวนวันที่ค้างชำระ"
        action={
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            เพิ่ม Rule
          </button>
        }
      />

      {/* Letter Settings Card */}
      <Card className="rounded-xl border border-border/50 bg-card shadow-sm mb-6">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <FileSignature className="size-4 text-primary" />
            <div className="text-sm font-semibold">ตั้งค่าหนังสือทวงถาม</div>
          </div>
          <p className="text-xs text-muted-foreground mb-4 leading-snug">
            ตั้งค่าลายเซ็นและหัวกระดาษสำหรับหนังสือ 45 วัน และ 60 วัน —
            PDF จะถูกสร้างโดยใช้ข้อมูลนี้
          </p>

          <div className="space-y-4">
            <LetterAssetField
              label="ลายเซ็นต์ผู้มีอำนาจ *"
              hint="PNG 200×80px พื้นหลังโปร่งใส"
              currentUrl={signatureUrl}
              uploadKind="LETTER_SIGNATURE"
              onSaved={(url) => saveConfig('letter_signature_url', url)}
            />
            <LetterAssetField
              label="หัวกระดาษ (ไม่บังคับ)"
              hint="PNG 600×100px แนวนอน"
              currentUrl={letterheadUrl}
              uploadKind="LETTER_LETTERHEAD"
              onSaved={(url) => saveConfig('letter_letterhead_url', url)}
            />
          </div>

          {!signatureUrl && (
            <div className="mt-4 rounded-lg bg-warning/5 border border-warning/20 p-3 text-xs text-warning leading-snug">
              ยังไม่ได้อัปโหลดลายเซ็น — PDF ที่สร้างจะไม่มีลายเซ็น โปรดอัปโหลดก่อนใช้งานจริง
            </div>
          )}
        </CardContent>
      </Card>

      {/* Event-triggered rules — read-only (Plan 2+ will add editing) */}
      {eventRules.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card shadow-sm p-5 mb-2">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="size-4 text-primary" />
            <div className="text-sm font-semibold">Event-triggered rules</div>
            <Badge variant="secondary" appearance="outline" size="sm">read-only</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Rules ที่ยิงตามเหตุการณ์ (ไม่ใช่ตามวัน) เช่น collector บันทึก NO_ANSWER → ส่ง LINE อัตโนมัติ
          </p>
          <div className="space-y-2">
            {eventRules.map((r) => {
              const channelCfg = getStatusBadgeProps(r.channel, dunningChannelMap);
              return (
                <div
                  key={r.id}
                  className="border border-border/50 rounded-lg p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{r.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      trigger: <span className="font-mono">{r.eventTrigger}</span>
                      {' · '}
                      <Badge variant={channelCfg.variant} appearance={channelCfg.appearance} size="sm">
                        {channelCfg.label}
                      </Badge>
                    </div>
                    {r.messageTemplate && (
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {r.messageTemplate}
                      </div>
                    )}
                  </div>
                  <Badge variant={r.isActive ? 'success' : 'secondary'} appearance="outline" size="sm">
                    {r.isActive ? 'เปิด' : 'ปิด'}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <QueryBoundary
        isLoading={isLoading && rules.length === 0}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลด Rule ทวงหนี้ได้"
      >
        {sortedRules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground rounded-xl border border-border/50 bg-card shadow-sm">
            <Bell className="w-10 h-10 opacity-40" />
            <p className="text-sm">ยังไม่มี Rule ทวงหนี้</p>
            <button
              onClick={openCreate}
              className="text-sm text-primary hover:underline"
            >
              เพิ่ม Rule แรก
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-border/50 bg-card shadow-sm p-4">
            <div className="relative">
              {/* Vertical timeline line */}
              <div className="absolute left-[18px] top-3 bottom-3 w-px bg-border/60" />
              <div className="space-y-3">
                {sortedRules.map((rule) => {
                  const channelCfg = CHANNEL_CONFIG[rule.channel];
                  const ChannelIcon = channelCfg.icon;
                  return (
                    <div
                      key={rule.id}
                      className={`relative flex items-start gap-4 p-4 rounded-lg border transition-colors ${
                        rule.isActive
                          ? 'bg-card border-border hover:bg-muted/20'
                          : 'bg-muted/20 border-border/50 opacity-60'
                      }`}
                    >
                      {/* Timeline dot */}
                      <div className="flex-shrink-0 flex flex-col items-center pt-1">
                        <div
                          className={`w-3 h-3 rounded-full border-2 ${
                            rule.isActive
                              ? 'border-primary bg-primary/40'
                              : 'border-muted-foreground bg-muted'
                          }`}
                        />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* Trigger day badge */}
                            {rule.triggerDay !== null && (
                              <span
                                className={`text-xs font-mono px-2 py-0.5 rounded-full font-semibold ${getTriggerBadgeCls(rule.triggerDay)}`}
                              >
                                {rule.triggerDay >= 0
                                  ? `D+${rule.triggerDay}`
                                  : `D${rule.triggerDay}`}
                              </span>
                            )}
                            {/* Channel badge */}
                            {(() => {
                              const cfg = getStatusBadgeProps(rule.channel, dunningChannelMap);
                              return (
                                <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm" className="flex items-center gap-1">
                                  <ChannelIcon className="w-3 h-3" />
                                  {cfg.label}
                                </Badge>
                              );
                            })()}
                            {/* Payment link badge */}
                            {rule.includePaymentLink && (
                              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-info/20 text-info">
                                <Link2 className="w-3 h-3" />
                                Payment Link
                              </span>
                            )}
                            {/* Manual badge */}
                            {!rule.autoExecute && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-warning/20 text-warning">
                                Manual
                              </span>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleToggle(rule)}
                              title={rule.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                              className="p-1.5 rounded hover:bg-muted transition-colors"
                            >
                              {rule.isActive ? (
                                <ToggleRight className="w-5 h-5 text-primary" />
                              ) : (
                                <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                              )}
                            </button>
                            <button
                              onClick={() => openEdit(rule)}
                              title="แก้ไข"
                              className="p-1.5 rounded hover:bg-muted transition-colors"
                            >
                              <Pencil className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                            </button>
                            <button
                              onClick={() => handleDelete(rule)}
                              title="ลบ"
                              className="p-1.5 rounded hover:bg-destructive/20 transition-colors"
                            >
                              <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                            </button>
                          </div>
                        </div>

                        {/* Name */}
                        <p className="text-sm font-medium text-foreground mt-1">{rule.name}</p>

                        {/* Message preview */}
                        {rule.messageTemplate && (
                          <p className="text-xs text-muted-foreground mt-1 truncate max-w-md">
                            {rule.messageTemplate}
                          </p>
                        )}

                        {/* Escalate */}
                        {rule.escalateTo && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                            <ArrowRight className="w-3 h-3" />
                            <span>Escalate: {rule.escalateTo}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </QueryBoundary>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editId ? 'แก้ไข Rule ทวงหนี้' : 'เพิ่ม Rule ทวงหนี้'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              ชื่อ Rule <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleFormChange('name', e.target.value)}
              placeholder="เช่น ทวงหนี้วันที่ 3"
              className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* TriggerDay + Channel */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                วันที่ทริกเกอร์{' '}
                <span className="text-muted-foreground text-xs">(ลบ = ก่อนครบ)</span>
              </label>
              <input
                type="number"
                value={form.triggerDay}
                onChange={(e) =>
                  handleFormChange('triggerDay', parseInt(e.target.value, 10) || 0)
                }
                className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {getTriggerLabel(form.triggerDay)}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">ช่องทาง</label>
              <select
                value={form.channel}
                onChange={(e) => handleFormChange('channel', e.target.value as DunningChannel)}
                className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {CHANNEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Message Template */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              เทมเพลตข้อความ
            </label>
            <div className="flex flex-wrap gap-1 mb-2">
              {TEMPLATE_VARS.map((v) => (
                <button
                  key={v.var}
                  type="button"
                  onClick={() => insertVar(v.var)}
                  title={v.desc}
                  className="px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground hover:bg-primary/20 hover:text-primary transition-colors"
                >
                  {v.var}
                </button>
              ))}
            </div>
            <textarea
              value={form.messageTemplate}
              onChange={(e) => handleFormChange('messageTemplate', e.target.value)}
              rows={4}
              placeholder="ระบุข้อความ เช่น สวัสดีคุณ {{customerName}} ..."
              className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          {/* Escalate To */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Escalate ไปยัง Rule ID{' '}
              <span className="text-muted-foreground text-xs">(ไม่บังคับ)</span>
            </label>
            <input
              type="text"
              value={form.escalateTo}
              onChange={(e) => handleFormChange('escalateTo', e.target.value)}
              placeholder="UUID ของ rule ปลายทาง"
              className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Sort Order */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              ลำดับ (sortOrder)
            </label>
            <input
              type="number"
              value={form.sortOrder}
              onChange={(e) =>
                handleFormChange('sortOrder', parseInt(e.target.value, 10) || 0)
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Checkboxes */}
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.includePaymentLink}
                onChange={(e) => handleFormChange('includePaymentLink', e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary"
              />
              <span className="text-sm text-foreground">แนบลิงก์ชำระเงิน (Payment Link)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.autoExecute}
                onChange={(e) => handleFormChange('autoExecute', e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary"
              />
              <span className="text-sm text-foreground">ส่งอัตโนมัติ (Auto Execute)</span>
            </label>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 rounded-md border border-border text-sm hover:bg-muted transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saveMutation.isPending
                ? 'กำลังบันทึก...'
                : editId
                  ? 'อัปเดต'
                  : 'เพิ่ม Rule'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        description={confirmDialog.description}
        variant="destructive"
        onConfirm={() => {
          confirmDialog.action();
        }}
      />
    </div>
  );
}
