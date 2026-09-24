import { useEffect, useRef, useState } from 'react';
import { Camera, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Group } from '../RoomDossier';
import type { FinanceApplicationModel } from '../../hooks/useFinanceApplication';
import GfinSlotPicker from './GfinSlotPicker';
import { GFIN_ACCEPT, PRIMARY_SLOTS, REQUIRED_SLOTS, SLOT_LABELS, SLOT_ORDER, slotCounts, type FinanceSlot } from './gfin';
import { openCreditDocument } from '@/lib/credit-document';
import { formatThaiTime } from '@/lib/date';

export default function GfinStepFiles({ gfin, onBack, onNext, dropFiles, onDropFilesHandled }: { gfin: FinanceApplicationModel; onBack?: () => void; onNext?: () => void; dropFiles: File[] | null; onDropFilesHandled: () => void }) {
  const app = gfin.current!;
  const counts = slotCounts(app.files);
  const [showAll, setShowAll] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);   // รอเลือกช่อง (อัปโหลด/ลากไฟล์)
  const [uploadSlot, setUploadSlot] = useState<FinanceSlot | null>(null); // กด "อัปโหลด/ถ่าย" ของช่องนั้น → เปิด input
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (dropFiles?.length) { setPendingFiles(dropFiles); onDropFilesHandled(); } }, [dropFiles, onDropFilesHandled]);
  useEffect(() => { if (uploadSlot) input.current?.click(); }, [uploadSlot]);
  const filled = PRIMARY_SLOTS.filter(s => counts[s] > 0).length;
  const slots = showAll ? SLOT_ORDER : SLOT_ORDER.filter(s => PRIMARY_SLOTS.includes(s) || counts[s] > 0);
  const missingRequired = gfin.preview?.missingRequiredSlots ?? REQUIRED_SLOTS.filter(s => counts[s] === 0);
  const usedPhone = app.product?.category === 'PHONE_USED';
  const sourceLine = (slot: FinanceSlot) => { const fs = app.files.filter(f => f.slot === slot); if (!fs.length) return 'ยังไม่มี'; const imgs = fs.filter(f => f.mimeType.startsWith('image/')).length; const pdfs = fs.length - imgs; const src = fs.every(f => f.source === 'PRODUCT_PHOTO') ? 'จากสต๊อก' : fs.some(f => f.source === 'CHAT_MESSAGE') ? `จากแชท ${formatThaiTime(fs[0].createdAt)}` : 'อัปโหลด'; return `${fs.length} ไฟล์${pdfs ? ` · รูป ${imgs} + PDF ${pdfs}` : ''} · ${src}`; };
  return (
    <Group label="3 รูป" count={app.files.length} right={<button type="button" onClick={() => setPendingFiles([])}>อัปโหลด</button>}>
      <p className="m-0 text-xs leading-snug text-muted-foreground">ลากจากแชทมาวาง หรือกดปุ่ม GFIN ข้างรูป · ครบ {filled}/{PRIMARY_SLOTS.length} ช่อง · PDF ใช้ได้ เปิดในหน้าลิงก์</p>
      <ul className="m-0 mt-2 list-none divide-y divide-border p-0">
        {slots.map(slot => (
          <li key={slot} className="py-1.5 text-xs leading-snug">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0"><p className="m-0 font-semibold">{SLOT_LABELS[slot]}{REQUIRED_SLOTS.includes(slot) && counts[slot] === 0 && <span className="ml-1 text-destructive">*ต้องมี</span>}</p><p className="m-0 text-muted-foreground">{sourceLine(slot)}</p></div>
              <div className="flex shrink-0 gap-1">
                {slot === 'DEVICE_SCREEN' && <Button size="sm" variant="outline" aria-label="ถ่ายหน้าจอเครื่อง" onClick={() => setUploadSlot(slot)}><Camera className="size-3.5" /></Button>}
                {slot === 'DEVICE_PHOTO' && counts[slot] === 0 && usedPhone && <Button size="sm" variant="outline" disabled={gfin.busy} onClick={() => gfin.fromProduct()}>ดึงจากสต๊อก</Button>}
                {slot !== 'DEVICE_SCREEN' && <Button size="sm" variant="outline" aria-label={`อัปโหลดเข้าช่อง ${SLOT_LABELS[slot]}`} onClick={() => setUploadSlot(slot)}><Upload className="size-3.5" /></Button>}
              </div>
            </div>
            {counts[slot] > 0 && <ul className="m-0 mt-1 list-none p-0">{app.files.filter(f => f.slot === slot).map(f => <li key={f.id} className="flex items-center justify-between gap-2 py-0.5"><button type="button" className="min-w-0 truncate text-left text-primary hover:underline" onClick={() => openCreditDocument(`/finance-applications/${app.id}/files/${f.id}`)}>{f.originalName ?? (f.sourceAngle ? `มุม ${f.sourceAngle}` : f.mimeType.startsWith('image/') ? 'รูป' : 'ไฟล์')}</button>{!f.sentAt && <button type="button" aria-label="เอาไฟล์ออก" disabled={gfin.busy} onClick={() => gfin.removeFile(f.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>}</li>)}</ul>}
          </li>
        ))}
      </ul>
      {!showAll && <button type="button" className="mt-1 text-xs font-semibold text-primary" onClick={() => setShowAll(true)}>เพิ่มช่อง (บัตรคนค้ำ · บิลที่อยู่ · ระยะเวลาเปิดเบอร์ · อื่น ๆ)</button>}
      {!usedPhone && counts.DEVICE_PHOTO === 0 && <p className="m-0 mt-1 text-xs leading-snug text-muted-foreground">เครื่องใหม่ หรือมือสองที่ยังถ่ายไม่ครบ: ช่อง 6 มุมต้องถ่ายเพิ่ม</p>}
      <input ref={input} type="file" multiple accept={GFIN_ACCEPT} capture={uploadSlot === 'DEVICE_SCREEN' ? 'environment' : undefined} className="hidden" onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length && uploadSlot) gfin.upload(uploadSlot, files); setUploadSlot(null); }} />
      <GfinSlotPicker open={pendingFiles !== null} onOpenChange={o => !o && setPendingFiles(null)} counts={counts} title={pendingFiles?.length ? `ไฟล์ ${pendingFiles.length} ไฟล์ ใส่ช่องไหน?` : 'อัปโหลดเข้าช่องไหน?'} onPick={slot => { const files = pendingFiles ?? []; setPendingFiles(null); if (files.length) gfin.upload(slot, files); else setUploadSlot(slot); }} />
      {onBack && onNext && <div className="mt-2.5 grid grid-cols-2 gap-1.5"><Button size="sm" variant="outline" onClick={onBack}>ย้อนกลับ</Button><Button size="sm" disabled={missingRequired.length > 0} title={missingRequired.length ? `ยังขาด ${missingRequired.map(s => SLOT_LABELS[s]).join(', ')}` : undefined} onClick={onNext}>ถัดไป: ข้อความ</Button></div>}
    </Group>
  );
}
