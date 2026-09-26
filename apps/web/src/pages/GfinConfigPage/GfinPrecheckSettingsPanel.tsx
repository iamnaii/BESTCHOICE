import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Send } from 'lucide-react';
import { PRECHECK_TEMPLATE_ERROR_LABEL, PRECHECK_TEMPLATE_PLACEHOLDERS, validatePrecheckTemplate } from '@installment/shared';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { formatThaiDateShort } from '@/lib/date';
import { LINE_GROUP_REASON_LABEL, type GfinLineGroupStatus } from '@/pages/UnifiedInboxPage/components/gfin/gfin';

/** shape ของ GET /gfin-precheck-settings */
export interface GfinPrecheckSettingsApi {
  company: { lineGroupId: string | null; precheckTemplate: string | null };
  groups: Array<{ groupId: string; groupName: string | null; pictureUrl: string | null; memberCount: number | null; joinedAt: string; leftAt: string | null }>;
  defaultTemplate: string;
  status: GfinLineGroupStatus;
}
export const GFIN_PRECHECK_SETTINGS_QUERY_KEY = ['gfin-precheck-settings'] as const;
const EDIT_ROLES = ['OWNER', 'FINANCE_MANAGER'];

/** ตั้งค่า › การเงิน › GFIN › กลุ่มไลน์ & ข้อความ (spec §6.5, mockup บอร์ด 9) — OWNER/ผจก.การเงินแก้ได้ role อื่นดูอย่างเดียว */
export function GfinPrecheckSettingsPanel() {
  const { user } = useAuth();
  const canEdit = EDIT_ROLES.includes(user?.role ?? '');
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<GfinPrecheckSettingsApi>({
    queryKey: GFIN_PRECHECK_SETTINGS_QUERY_KEY,
    queryFn: async () => (await api.get<GfinPrecheckSettingsApi>('/gfin-precheck-settings')).data,
  });
  const [groupId, setGroupId] = useState<string | null>(null);
  const [template, setTemplate] = useState('');
  useEffect(() => { if (data) { setGroupId(data.company.lineGroupId); setTemplate(data.company.precheckTemplate ?? ''); } }, [data]);

  const save = useMutation({
    mutationFn: (payload: { lineGroupId: string | null; precheckTemplate: string | null }) => api.put('/gfin-precheck-settings', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: GFIN_PRECHECK_SETTINGS_QUERY_KEY }); qc.invalidateQueries({ queryKey: ['room-gfin'] }); toast.success('บันทึกกลุ่มไลน์และแม่แบบแล้ว'); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const test = useMutation({
    mutationFn: async () => (await api.post('/gfin-precheck-settings/test-message')).data as { ok: boolean; groupName: string | null; requestId: string | null },
    onSuccess: (r) => toast.success(`ส่งข้อความทดสอบเข้ากลุ่ม "${r.groupName ?? 'GFIN'}" แล้ว — เปิดไลน์ดูได้เลย`),
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  if (isLoading) return <div className="p-4 text-muted-foreground leading-snug">กำลังโหลด...</div>;
  if (error || !data) return <div className="p-4 text-destructive leading-snug">เกิดข้อผิดพลาด — โปรดลองรีเฟรช</div>;

  const handleSave = () => {
    const t = template.trim();
    if (t) {
      const v = validatePrecheckTemplate(t);
      if (v.errors.length) {
        toast.error(v.errors.map((e) => (e === 'UNKNOWN_PLACEHOLDER' ? `${PRECHECK_TEMPLATE_ERROR_LABEL[e]}: ${v.unknown.map((u) => `{{${u}}}`).join(', ')}` : PRECHECK_TEMPLATE_ERROR_LABEL[e])).join(' · '));
        return;
      }
    }
    save.mutate({ lineGroupId: groupId, precheckTemplate: t || null });
  };
  const status = data.status;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-base font-semibold leading-snug">กลุ่มไลน์ที่รับชุดเช็ค</h2>
        {status.ready
          ? <p className="m-0 flex items-center gap-1 text-sm leading-snug"><CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden />{status.groupName ?? status.groupId} · พร้อมส่งด้วยบอท</p>
          : <p className="m-0 flex items-center gap-1 text-sm leading-snug text-warning-strong"><AlertTriangle className="size-4 shrink-0" aria-hidden />{LINE_GROUP_REASON_LABEL[status.reason ?? 'NOT_LINKED']}</p>}
        <ol className="m-0 list-decimal space-y-1 pl-5 text-sm leading-snug text-muted-foreground">
          <li>LINE Official Account Manager ของ OA ไฟแนนซ์ (น้องเบส): เปิด &quot;อนุญาตให้เข้าร่วมกลุ่มและแชทหลายคน&quot; และปิดข้อความทักทายเมื่อเข้ากลุ่ม</li>
          <li>เชิญ OA ไฟแนนซ์เข้ากลุ่ม GFIN : BESTCHOICE — บอทจะจดชื่อกลุ่มให้อัตโนมัติภายในไม่กี่วินาที</li>
          <li>เลือกกลุ่มด้านล่าง กด &quot;บันทึก&quot; แล้ว &quot;ส่งข้อความทดสอบ&quot; ให้เจ้าหน้าที่ GFIN เห็นก่อนใช้จริง</li>
        </ol>
        {data.groups.length === 0
          ? <p className="m-0 rounded-lg border border-border bg-muted/40 p-3 text-sm leading-snug">ยังไม่มีกลุ่มที่บอทเคยเข้า — ทำข้อ 1–2 ก่อน แล้วรีเฟรชหน้านี้</p>
          : (
            <RadioGroup value={groupId ?? ''} onValueChange={(v) => setGroupId(v || null)} disabled={!canEdit} aria-label="กลุ่มไลน์ปลายทาง">
              {data.groups.map((g) => {
                const label = g.groupName ?? g.groupId;
                return (
                  <label key={g.groupId} className={`flex items-start gap-2 rounded-lg border border-border p-2 text-sm leading-snug ${g.leftAt ? 'opacity-70' : ''}`}>
                    <RadioGroupItem value={g.groupId} disabled={!canEdit || !!g.leftAt} aria-label={label} className="mt-0.5" />
                    <span className="flex-1">
                      <span className="block font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">เข้ากลุ่ม {formatThaiDateShort(g.joinedAt)}{g.memberCount !== null ? ` · สมาชิก ${g.memberCount} คน` : ''}</span>
                      {g.leftAt && <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning-strong"><AlertTriangle className="size-3" aria-hidden />บอทออกจากกลุ่มแล้ว</span>}
                    </span>
                  </label>
                );
              })}
            </RadioGroup>
          )}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={handleSave} disabled={save.isPending}>บันทึก</Button>
            <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !status.ready} title={!status.ready ? 'บันทึกกลุ่มที่บอทอยู่ก่อน' : undefined}><Send className="mr-1 size-4" aria-hidden />ส่งข้อความทดสอบ</Button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold leading-snug">ข้อความ 12 ข้อ (แม่แบบ)</h2>
        <p className="m-0 text-sm leading-snug text-muted-foreground">ว่าง = ใช้ถ้อยคำมาตรฐานของระบบ · ตัวแปรที่ใช้ได้: {PRECHECK_TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(' ')} · ต้องมี {'{{link}}'} เสมอ</p>
        <label htmlFor="gfin-precheck-template" className="text-sm font-medium leading-snug">แม่แบบข้อความ 12 ข้อ</label>
        <Textarea id="gfin-precheck-template" rows={16} className="font-sans text-sm leading-snug" value={template} placeholder={data.defaultTemplate} disabled={!canEdit} onChange={(e) => setTemplate(e.target.value)} />
        {canEdit && <Button variant="ghost" size="sm" onClick={() => setTemplate(data.defaultTemplate)}>ใช้ค่าเริ่มต้น</Button>}
      </section>
    </div>
  );
}
