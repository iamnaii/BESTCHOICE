import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Group } from '../RoomDossier';
import type { FinanceApplicationModel } from '../../hooks/useFinanceApplication';
import { GFIN_LINE_GROUP, editableMessageText, productLabel, imeiTail, quietly } from './gfin';

export default function GfinStepMessage({ gfin, onBack }: { gfin: FinanceApplicationModel; onBack: () => void }) {
  const app = gfin.current!;
  const preview = gfin.preview;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(app.messageOverride ?? '');
  const [confirm, setConfirm] = useState(false);
  const [checked, setChecked] = useState(false);
  /* เปิดช่องแก้ = เริ่มจากถ้อยคำที่บันทึกไว้ ไม่มีก็ข้อความตัวอย่างปัจจุบัน (ไม่รวมบรรทัดลิงก์ที่ระบบต่อท้ายเอง) — minor 3 */
  const startEditing = () => { setText(app.messageOverride ?? editableMessageText(preview?.text ?? '')); setEditing(true); };
  const copyAndSend = async () => {
    let r: Awaited<ReturnType<FinanceApplicationModel['send']>>;
    try { r = await gfin.send('COPY'); } catch { return; /* toast จาก hook */ }
    setConfirm(false);
    try { await navigator.clipboard.writeText(r.messageText); toast.success('คัดลอกแล้ว วางในกลุ่มไลน์ GFIN ได้เลย'); }
    catch { toast.error('คัดลอกอัตโนมัติไม่ได้ — กด "คัดลอกข้อความอีกครั้ง" ในการ์ดสถานะ'); }
  };
  const saveText = async () => { try { await gfin.update({ messageOverride: text.trim() || null }); setEditing(false); } catch { /* toast จาก hook */ } };
  return (
    <Group label="4 ข้อความ" right={<button type="button" onClick={() => (editing ? setEditing(false) : startEditing())}>{editing ? 'ใช้แม่แบบเดิม' : 'แก้ข้อความ'}</button>}>
      <p className="m-0 text-xs leading-snug text-muted-foreground">ถ้อยคำเดียวกับที่ทีมส่งทุกวันนี้ + ลิงก์ชุดเอกสารต่อท้าย</p>
      {editing ? (
        <><Textarea aria-label="ข้อความ 12 ข้อ" rows={14} className="mt-2 text-xs leading-snug" value={text} onChange={e => setText(e.target.value)} placeholder={preview?.text} />
          <div className="mt-1 flex gap-1.5"><Button size="sm" disabled={gfin.busy} onClick={saveText}>บันทึกถ้อยคำ</Button><Button size="sm" variant="ghost" onClick={() => { setText(''); quietly(gfin.update({ messageOverride: null })); setEditing(false); }}>ล้าง</Button></div>
          <p className="m-0 mt-1 text-xs text-muted-foreground">บรรทัด "เอกสารทั้งหมด N ไฟล์: ลิงก์" ระบบต่อท้ายให้เสมอ ไม่ต้องพิมพ์</p></>
      ) : (
        <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-2 font-sans text-xs leading-snug">{preview?.text ?? 'กำลังร่าง…'}</pre>
      )}
      <p className="m-0 mt-2 text-xs leading-snug text-muted-foreground">ส่ง 1 ข้อความ · เอกสารทุกไฟล์รวม PDF เปิดในหน้าลิงก์ · ลิงก์ใช้ได้ 7 วัน · ยกเลิกได้ทุกเมื่อ · ระบบจดว่าใครเปิดเมื่อไร</p>
      {preview?.warnings.map(w => <p key={w} className="m-0 mt-1 text-xs leading-snug text-warning-strong">{w}</p>)}
      <div className="mt-2.5 grid gap-1.5">
        <Button size="sm" disabled title="ส่งด้วยบอทจะเปิดใน PR 2 — ใช้คัดลอกไปก่อน">ส่งเช็ค GFIN</Button>
        <Button size="sm" variant="outline" disabled={!preview?.canSend || gfin.busy} onClick={() => setConfirm(true)}>คัดลอกข้อความ + ลิงก์</Button>
        <Button size="sm" variant="ghost" onClick={onBack}>ย้อนกลับ</Button>
      </div>
      <p className="m-0 mt-1 text-xs leading-snug text-muted-foreground">บอทส่งเข้ากลุ่มจะพร้อมในเฟสถัดไป · ตอนนี้คัดลอกแล้ววางในกลุ่ม "{GFIN_LINE_GROUP}" เอง ลิงก์เดียวกัน</p>
      <Dialog open={confirm} onOpenChange={o => { setConfirm(o); if (!o) setChecked(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>ทำเครื่องหมายว่าส่งเข้ากลุ่ม "GFIN : BESTCHOICE"?</DialogTitle></DialogHeader>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs leading-snug">
            <dt className="text-muted-foreground">ลูกค้า</dt><dd className="m-0">{app.customer?.name} · {productLabel(app.product)} · {imeiTail(app.product?.imeiSerial)}</dd>
            <dt className="text-muted-foreground">จะส่ง</dt><dd className="m-0">1 ข้อความ = 12 ข้อ + ลิงก์ชุดเอกสาร {app.files.length} ไฟล์</dd>
            <dt className="text-muted-foreground">ลิงก์</dt><dd className="m-0">ใช้ได้ 7 วัน · ยกเลิกได้ทุกเมื่อ · ระบบจดว่าใครเปิดเมื่อไร</dd>
            <dt className="text-muted-foreground">ใครเห็น</dt><dd className="m-0">สมาชิกกลุ่ม · ลูกค้าไม่เห็น · ตัวอย่างลิงก์ในไลน์ไม่โชว์ชื่อลูกค้า</dd>
          </dl>
          <label className="flex items-start gap-2 text-xs leading-snug"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="mt-0.5" />ตรวจแล้วว่าไฟล์ทุกใบเป็นของลูกค้าคนนี้ ไม่ติดข้อมูลคนอื่น</label>
          <DialogFooter><Button variant="outline" onClick={() => setConfirm(false)}>ยกเลิก</Button><Button disabled={!checked || gfin.busy} onClick={copyAndSend}>คัดลอกและทำเครื่องหมายว่าส่งแล้ว</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Group>
  );
}
