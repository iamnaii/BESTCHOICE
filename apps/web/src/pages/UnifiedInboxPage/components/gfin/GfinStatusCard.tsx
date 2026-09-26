import { useState } from 'react';
import { Link } from 'react-router';
import { ExternalLink, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Group } from '../RoomDossier';
import type { FinanceApplicationModel } from '../../hooks/useFinanceApplication';
import GfinStepFiles from './GfinStepFiles';
import { GFIN_WEB_FORM_URL, OPEN_STATUSES, STATUS_LABEL, productLabel, imeiTail, slotCounts, PRIMARY_SLOTS, quietly, staffViewUrl, statusBadgeLabel, lineGroupLabel, type FinanceApplication, type FinanceEvent } from './gfin';
import { formatThaiDateShort, formatThaiDateTime, formatThaiTime } from '@/lib/date';

const EVENT_LABEL: Record<FinanceEvent['kind'], string> = {
  CREATED: 'สร้างใบยื่น', SENT: 'ส่งเข้ากลุ่มแล้ว', RESENT: 'ส่งเพิ่ม', LINK_VIEWED: 'GFIN เปิดดูลิงก์', LINK_EXTENDED: 'ต่ออายุลิงก์', LINK_REVOKED: 'ยกเลิกลิงก์',
  PARTNER_ACK: 'GFIN รับเรื่อง', PARTNER_MORE_INFO: 'GFIN ตอบผ่านหน้าลิงก์: ขอเอกสารเพิ่ม', PARTNER_APPROVED: 'GFIN ตอบผ่านหน้าลิงก์: ผ่าน', PARTNER_REJECTED: 'GFIN ตอบผ่านหน้าลิงก์: ไม่ผ่าน',
  STAFF_RESULT: 'ร้านบันทึกผลเอง', CANCELLED: 'ยกเลิกใบยื่น', FILES_PURGED: 'ลบไฟล์ตามนโยบาย 90 วัน',
};
const badgeClass = (s: FinanceApplication['status']) => s === 'APPROVED' ? 'bg-primary/10 text-primary' : s === 'REJECTED' || s === 'CANCELLED' ? 'bg-destructive/10 text-destructive' : s === 'MORE_INFO' ? 'bg-warning/10 text-warning-strong' : 'bg-muted text-foreground';

export default function GfinStatusCard({ app, gfin, history, onAddMore, showFilesStep, onCloseFiles, dropFiles, onDropFilesHandled }: {
  app: FinanceApplication; gfin: FinanceApplicationModel; history: FinanceApplication[]; onAddMore: () => void; showFilesStep: boolean; onCloseFiles: () => void;
  onPickSlotForMessage?: (messageId: string) => void; dropFiles: File[] | null; onDropFilesHandled: () => void;
}) {
  const open = OPEN_STATUSES.includes(app.status);
  const counts = slotCounts(app.files);
  const filledSlots = PRIMARY_SLOTS.filter(s => counts[s] > 0).length;
  const pendingFiles = app.files.filter(f => !f.sentAt).length;
  const linkAlive = !!app.shareExpiresAt && !app.shareRevokedAt && new Date(app.shareExpiresAt) > new Date();
  const [note, setNote] = useState('');
  /* ข้อความ "ส่งเพิ่ม" ล่าสุดของใบนี้ — ปุ่ม "คัดลอกข้อความอีกครั้ง" คัดลอกอันนี้ถ้ามี (minor 2) · ผูกกับ id ใบ กันข้ามใบ */
  const [lastResend, setLastResend] = useState<{ appId: string; text: string } | null>(null);
  const resendText = lastResend?.appId === app.id ? lastResend.text : null;
  const textToCopy = resendText ?? app.messageText;
  const copyText = async () => {
    if (!textToCopy) return;
    try { await navigator.clipboard.writeText(textToCopy); toast.success(resendText ? 'คัดลอกข้อความ "ส่งเพิ่ม" แล้ว' : 'คัดลอกข้อความ + ลิงก์แล้ว'); }
    catch { toast.error('คัดลอกไม่ได้ — เบราว์เซอร์ไม่อนุญาตให้เข้าถึงคลิปบอร์ด ลองกดใหม่อีกครั้ง'); }
  };
  /* พนักงานเปิดเอง = `?src=staff` ไม่นับเป็น "GFIN เปิดดู" (minor 7) */
  const openLink = async () => {
    try { const { url } = await gfin.shareLink(); window.open(staffViewUrl(url), '_blank', 'noopener,noreferrer'); }
    catch { /* toast จาก hook */ }
  };
  /* F1 (final-fix wave, spec §3): ปุ่มคัดลอกต้องเป็นทางถอยที่กดได้จริงเสมอแม้กลุ่มพร้อม — เดิมเลือก via
   * จาก lineGroup.ready ครั้งเดียวตอนกด ทำให้ตอนบอทตอบ 429/5xx/timeout ไม่มีทางคัดลอกได้เลยนอกจากกด
   * "คัดลอกข้อความอีกครั้ง" ที่คัดลอกข้อความเดิมซ้ำและไม่นับเป็นส่งเพิ่ม — แยกเป็นสอง action ชัดเจนแทน */
  const resendVia = async (via: 'BOT' | 'COPY') => {
    let r: Awaited<ReturnType<FinanceApplicationModel['resend']>>;
    try { r = await gfin.resend(via); } catch { return; /* toast จาก hook */ }
    setLastResend({ appId: app.id, text: r.messageText });
    onCloseFiles();
    if (r.pushed) { toast.success(`ส่งเพิ่มเข้ากลุ่ม "${r.groupName ?? lineGroupLabel(gfin.lineGroup)}" แล้ว${r.rotated ? ' (ลิงก์ใหม่ — ลิงก์เดิมถูกยกเลิกไว้)' : ''}`); return; }
    try {
      await navigator.clipboard.writeText(r.messageText);
      toast.success(r.rotated ? 'ส่งเพิ่มด้วยลิงก์ใหม่ (ลิงก์เดิมถูกยกเลิกไว้) — คัดลอกข้อความแล้ว วางในกลุ่มไลน์ได้เลย' : 'คัดลอกข้อความ "ส่งเพิ่ม" แล้ว วางในกลุ่มไลน์ได้เลย');
    } catch {
      toast.error('บันทึกส่งเพิ่มแล้ว แต่คัดลอกอัตโนมัติไม่ได้ — กด "คัดลอกข้อความอีกครั้ง" แล้ววางในกลุ่มไลน์');
    }
  };
  const latestPartner = [...app.events].reverse().find(e => e.actorType === 'PARTNER' && e.note);
  return (
    <div className="flex flex-col gap-2.5 p-2.5">
      <Group label={`ใบยื่น ${app.number}`} right={<span className={`rounded-full px-2 py-0.5 text-[11px] ${badgeClass(app.status)}`}>{statusBadgeLabel(app)}</span>}>
        <p className="m-0 text-xs leading-snug">{productLabel(app.product)} · {app.product?.category === 'PHONE_USED' ? 'มือ 2' : 'มือ 1'} · {imeiTail(app.product?.imeiSerial)}</p>
        <p className="m-0 text-xs leading-snug text-muted-foreground">ข้อความ 12 ข้อ + ลิงก์ · {app.files.length} ไฟล์ · {filledSlots} ช่อง{app.sentVia ? ` · ${app.sentVia === 'BOT' ? 'ส่งด้วยบอท' : 'ส่งแบบคัดลอก'}` : ''}</p>
        {app.product && !['IN_STOCK', 'RESERVED'].includes(app.product.status) && <p className="m-0 mt-1 text-xs leading-snug text-warning-strong">สถานะเครื่องเปลี่ยนไปจากตอนส่ง ({app.product.status}) — ตรวจสต๊อกก่อนทำใบขาย</p>}
        <div className="mt-2 rounded-lg border border-border p-2 text-xs leading-snug">
          <p className="m-0 font-semibold">ลิงก์ชุดเอกสาร · เปิดดู {app.shareViewCount} ครั้ง</p>
          <p className="m-0 text-muted-foreground">{app.shareLastViewedAt ? `ล่าสุด ${formatThaiTime(app.shareLastViewedAt)}` : 'ยังไม่มีใครเปิด'}{app.shareExpiresAt ? ` · ${linkAlive ? 'หมดอายุ' : 'หมดอายุแล้ว'} ${formatThaiDateShort(app.shareExpiresAt)}` : ''}{app.shareRevokedAt ? ' · ยกเลิกแล้ว' : ''}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={openLink} disabled={!linkAlive || gfin.busy}><ExternalLink className="mr-1 size-3.5" />เปิดหน้าลิงก์</Button>
            <Button size="sm" variant="outline" onClick={copyText} disabled={!textToCopy} title={resendText ? 'คัดลอกข้อความ "ส่งเพิ่ม" ล่าสุด' : undefined}><Copy className="mr-1 size-3.5" />คัดลอกข้อความอีกครั้ง</Button>
            {/* ลิงก์ที่ยกเลิกแล้วตายถาวร — กดอีกทีได้ลิงก์ใหม่ (API หมุนโทเคน — I2) */}
            {open && <Button size="sm" variant="ghost" onClick={() => quietly(gfin.extend().then((r) => { if (r.rotated) setLastResend(null); }))} disabled={gfin.busy}>{app.shareRevokedAt ? 'ออกลิงก์ใหม่' : 'ต่ออายุ'}</Button>}
            {linkAlive && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => quietly(gfin.revoke())} disabled={gfin.busy}>ยกเลิกลิงก์</Button>}
          </div>
        </div>
      </Group>
      <Group label="ไทม์ไลน์">
        <ol className="m-0 list-none p-0 text-xs leading-snug">{app.events.map(e => <li key={e.id} className="border-l-2 border-border py-1 pl-2"><p className="m-0 font-semibold">{EVENT_LABEL[e.kind]}</p><p className="m-0 text-muted-foreground">{formatThaiDateTime(e.createdAt)}{e.actorName ? ` · ${e.actorName}` : ''}{e.note ? ` · "${e.note}"` : ''}</p></li>)}</ol>
      </Group>
      {open && (
        <Group label="ขั้นต่อไป">
          {latestPartner?.note && <p className="m-0 mb-1.5 rounded-md bg-warning/10 p-2 text-xs leading-snug text-warning-strong">GFIN: "{latestPartner.note}"</p>}
          {showFilesStep ? (<><GfinStepFiles gfin={gfin} dropFiles={dropFiles} onDropFilesHandled={onDropFilesHandled} /><div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <Button size="sm" variant="outline" onClick={onCloseFiles}>ปิด</Button>
            {gfin.lineGroup?.ready
              ? <Button size="sm" disabled={pendingFiles === 0 || gfin.busy} title="บอทส่งเข้ากลุ่มให้" onClick={() => resendVia('BOT')}>ส่งเพิ่มด้วยบอท ({pendingFiles} ไฟล์ใหม่)</Button>
              : <Button size="sm" disabled={pendingFiles === 0 || gfin.busy} title="บอทไม่พร้อม — จะคัดลอกข้อความให้วางเอง" onClick={() => resendVia('COPY')}>ส่งเพิ่ม ({pendingFiles} ไฟล์ใหม่)</Button>}
            {/* ทางถอยที่กดได้เสมอเมื่อกลุ่มพร้อม — บอทตอบ 429/5xx/timeout ก็ยังส่งเพิ่มแบบคัดลอกได้ (F1) */}
            {gfin.lineGroup?.ready && <Button size="sm" variant="outline" className="col-span-2" disabled={pendingFiles === 0 || gfin.busy} onClick={() => resendVia('COPY')}>ส่งเพิ่มแบบคัดลอก</Button>}
          </div></>)
            : <Button size="sm" className="w-full" onClick={onAddMore}>เพิ่มรูปแล้วส่งเพิ่ม</Button>}
          <p className="m-0 mt-2 text-xs font-semibold leading-snug">GFIN ตอบในไลน์แทน? บันทึกผลเอง</p>
          <input aria-label="หมายเหตุผล" className="mt-1 w-full rounded-md border border-border px-2 py-1 text-xs" placeholder="หมายเหตุ (ถ้ามี)" value={note} onChange={e => setNote(e.target.value)} />
          {/* ร้านบันทึกผลที่ได้ในไลน์เอง = "ผ่าน/ไม่ผ่าน/ขอเพิ่ม" · คำว่า "(แจ้งผ่านลิงก์)" อยู่ที่ป้ายสถานะเฉพาะผลที่ GFIN กดเองบนหน้าลิงก์ (minor 1) */}
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            <Button size="sm" disabled={gfin.busy} onClick={() => quietly(gfin.result('APPROVED', note || undefined))}>ผ่าน</Button>
            <Button size="sm" variant="outline" className="text-destructive" disabled={gfin.busy} onClick={() => quietly(gfin.result('REJECTED', note || undefined))}>ไม่ผ่าน</Button>
            <Button size="sm" variant="outline" disabled={gfin.busy} onClick={() => quietly(gfin.result('MORE_INFO', note || undefined))}>ขอเพิ่ม</Button>
          </div>
          <Button size="sm" variant="ghost" className="mt-1 w-full text-destructive" disabled={gfin.busy} onClick={() => quietly(gfin.cancel())}>ยกเลิกใบยื่น</Button>
        </Group>
      )}
      {app.status === 'APPROVED' && (
        <Group label="เมื่อผ่านแล้ว ขั้นต่อไป">
          <a href={GFIN_WEB_FORM_URL} target="_blank" rel="noopener noreferrer" className="block text-xs font-semibold text-primary hover:underline">กรอกฟอร์มเว็บ GFIN (เฟส 2 เติมให้)</a>
          <Link to="/pos" className="mt-1 block text-xs font-semibold text-primary hover:underline">ทำใบขายไฟแนนซ์นอกที่ POS · ใส่เลขสัญญา</Link>
        </Group>
      )}
      {!open && <Button size="sm" className="mx-0" disabled={gfin.busy} onClick={() => quietly(gfin.start())}>เริ่มใบยื่นใหม่</Button>}
      <Group label="ประวัติใบยื่น" count={history.length}>
        {history.length === 0 ? <p className="m-0 text-xs text-muted-foreground">ยังไม่มีใบก่อนหน้า</p> : <ul className="m-0 list-none p-0 text-xs">{history.map(h => <li key={h.id} className="flex justify-between py-1"><span>{h.number} · {formatThaiDateShort(h.createdAt)}</span><span className="font-semibold">{STATUS_LABEL[h.status]}</span></li>)}</ul>}
      </Group>
    </div>
  );
}
