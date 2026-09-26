import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Send } from 'lucide-react';
import { formatPrecheckTemplateErrors, PRECHECK_TEMPLATE_PLACEHOLDERS, validatePrecheckTemplate } from '@installment/shared';
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
  // ค่าที่พิมพ์/เลือกค้างไว้ (edits) ทับค่าจาก API ทีละช่อง จนกดบันทึก — เหมือน GfinSettingsPanel
  // (ห้ามใช้ useEffect sync จาก data: refetch พื้นหลัง เช่น reconnect/invalidate จากที่อื่น
  // จะมาเขียนทับข้อความที่ผู้ใช้พิมพ์ค้างไว้โดยไม่ได้กดบันทึกทันที)
  const [edits, setEdits] = useState<{ groupId?: string | null; template?: string }>({});

  const save = useMutation({
    mutationFn: (payload: { lineGroupId?: string | null; precheckTemplate?: string | null }) => api.put('/gfin-precheck-settings', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: GFIN_PRECHECK_SETTINGS_QUERY_KEY }); qc.invalidateQueries({ queryKey: ['room-gfin'] }); setEdits({}); toast.success('บันทึกกลุ่มไลน์และแม่แบบแล้ว'); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const test = useMutation({
    mutationFn: async () => (await api.post('/gfin-precheck-settings/test-message')).data as { ok: boolean; groupName: string | null; requestId: string | null },
    onSuccess: (r) => toast.success(`ส่งข้อความทดสอบเข้ากลุ่ม "${r.groupName ?? 'GFIN'}" แล้ว — เปิดไลน์ดูได้เลย`),
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  if (isLoading) return <div className="p-4 text-muted-foreground leading-snug">กำลังโหลด...</div>;
  if (error || !data) return <div className="p-4 text-destructive leading-snug">เกิดข้อผิดพลาด — โปรดลองรีเฟรช</div>;

  const groupId = edits.groupId !== undefined ? edits.groupId : data.company.lineGroupId;
  const template = edits.template ?? (data.company.precheckTemplate ?? '');
  // F5 (final-fix wave) — ส่งเฉพาะช่องที่ถูกแก้จริง ไม่ใช่ทั้งสองช่องเสมอ: เดิม save ทับ lineGroupId ทุกครั้ง
  // แม้ผู้ใช้แค่แก้แม่แบบ ⇒ ถ้ากลุ่มที่ผูกอยู่มี leftAt (บอทออกไปแล้ว) การ save แม่แบบล้วน ๆ จะ 400
  // "บอทออกจากกลุ่มนี้แล้ว" ทั้งที่ไม่ได้ตั้งใจแตะกลุ่มเลย
  const hasEdits = edits.groupId !== undefined || edits.template !== undefined;

  const handleSave = () => {
    if (!hasEdits) return;
    const payload: { lineGroupId?: string | null; precheckTemplate?: string | null } = {};
    if (edits.groupId !== undefined) payload.lineGroupId = edits.groupId;
    if (edits.template !== undefined) {
      const t = edits.template.trim();
      if (t) {
        const v = validatePrecheckTemplate(t);
        if (v.errors.length) {
          toast.error(formatPrecheckTemplateErrors(v));
          return;
        }
      }
      payload.precheckTemplate = t || null;
    }
    save.mutate(payload);
  };
  const status = data.status;
  // F6 (final-fix wave) — เลือกกลุ่มอื่นแล้วยังไม่กดบันทึก: "ส่งข้อความทดสอบ" ต้องปิดไว้ก่อน ไม่งั้นข้อความทดสอบ
  // จะส่งเข้ากลุ่มที่จอแสดงไว้ (เลือกใหม่ ยังไม่บันทึก) แทนกลุ่มที่ผูกจริงในระบบ (status อ่านจาก API เดิม)
  const unsavedGroupChoice = edits.groupId !== undefined;
  const testDisabled = test.isPending || !status.ready || unsavedGroupChoice;
  const testTitle = unsavedGroupChoice ? 'บันทึกกลุ่มที่เลือกก่อน' : (!status.ready ? 'บันทึกกลุ่มที่บอทอยู่ก่อน' : undefined);

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
          ? <p className="m-0 rounded-lg border border-border bg-muted/40 p-3 text-sm leading-snug">ยังไม่มีกลุ่มที่บอทเคยเข้า — ทำข้อ 1–2 ก่อน · ถ้าเชิญ OA ไว้ในกลุ่มแล้วก่อนอัปเดตนี้ ให้ใครก็ได้ในกลุ่มพิมพ์ข้อความ 1 ครั้ง (หรือนำ OA ออกแล้วเชิญใหม่) แล้วรีเฟรชหน้านี้</p>
          : (
            <RadioGroup value={groupId ?? ''} onValueChange={(v) => setEdits((prev) => ({ ...prev, groupId: v || null }))} disabled={!canEdit} aria-label="กลุ่มไลน์ปลายทาง">
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
            <Button variant="primary" onClick={handleSave} disabled={save.isPending || !hasEdits}>บันทึก</Button>
            <Button variant="outline" onClick={() => test.mutate()} disabled={testDisabled} title={testTitle}><Send className="mr-1 size-4" aria-hidden />ส่งข้อความทดสอบ</Button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold leading-snug">ข้อความ 12 ข้อ (แม่แบบ)</h2>
        <p className="m-0 text-sm leading-snug text-muted-foreground">ว่าง = ใช้ถ้อยคำมาตรฐานของระบบ · ตัวแปรที่ใช้ได้: {PRECHECK_TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(' ')} · ต้องมี {'{{link}}'} เสมอ</p>
        <label htmlFor="gfin-precheck-template" className="text-sm font-medium leading-snug">แม่แบบข้อความ 12 ข้อ</label>
        <Textarea id="gfin-precheck-template" rows={16} className="font-sans text-sm leading-snug" value={template} placeholder={data.defaultTemplate} disabled={!canEdit} onChange={(e) => setEdits((prev) => ({ ...prev, template: e.target.value }))} />
        {/* F8 (final-fix wave) — ล้างเป็นค่าว่าง (placeholder โชว์แม่แบบเริ่มต้นแทน) ไม่ใช่ copy ข้อความไปเก็บ
            ⇒ save ส่ง precheckTemplate: null (กลับไปใช้ค่าเริ่มต้นในโค้ด) ตามการแก้ค่าเริ่มต้นในอนาคตอัตโนมัติ */}
        {canEdit && <Button variant="ghost" size="sm" onClick={() => setEdits((prev) => ({ ...prev, template: '' }))}>ใช้ค่าเริ่มต้น</Button>}
      </section>
    </div>
  );
}
