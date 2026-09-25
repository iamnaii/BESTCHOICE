import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { canCreateCustomer, canFillProspectContact } from '@/lib/constants';
import { Group } from '../RoomDossier';
import type { DossierRoom } from '../RoomDossier';
import LinkCustomerDialog from '../LinkCustomerDialog';
import CustomerCreateDialog, { splitDisplayName } from '@/components/customer/CustomerCreateDialog';
import { useLinkRoomCustomer } from '../../hooks/useLinkRoomCustomer';
import type { AddressData } from '@/components/ui/AddressForm';
import type { FinanceApplicationModel, OcrIdCard } from '../../hooks/useFinanceApplication';
import { FIELD_LABELS, quietly } from './gfin';
import { formatThaiDate } from '@/lib/date';

/**
 * ขั้นที่ 1 ลูกค้า (final review C1):
 * - "ผู้สนใจอัตโนมัติจากแชท" (ธง `chatPlaceholder` จาก API) ไม่นับเป็นลูกค้าที่ผูกแล้ว — ชื่อเป็นชื่อโปรไฟล์แชท ไม่มีเบอร์/เลขบัตร
 *   ⇒ โชว์ทางอ่านบัตร + "เพิ่มเบอร์/ข้อมูลลูกค้า" (โหมด fill ของ CustomerCreateDialog = อัปเกรดคนเดิม ไม่สร้างซ้ำ)
 * - ห้องที่ผูกลูกค้าจริงอยู่แล้วแต่ใบยังว่าง (เช่น เติมเบอร์จากแผงลูกค้า) ⇒ ปุ่มใช้ลูกค้าของห้อง แทนการสร้างซ้ำ
 * - ช่องที่ขาด: อาชีพ = `occupationOverride` ของใบ · เบอร์/วันเกิด = `PATCH :id/customer-fields` (ทุก role ของแท็บนี้ —
 *   `PATCH /customers/:id` เปิดแค่ OWNER/BRANCH_MANAGER)
 */
export default function GfinStepCustomer({ room, gfin, onNext }: { room: DossierRoom; customerId: string | null; gfin: FinanceApplicationModel; onNext: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const app = gfin.current!;
  const [ocr, setOcr] = useState<OcrIdCard | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const idCardFile = app.files.find(f => f.slot === 'ID_CARD' && f.sourceMessageId);
  const roomCustomer = room.customer ?? null;
  const placeholderRoom = !!roomCustomer?.chatPlaceholder;
  const refreshRoom = () => {
    qc.invalidateQueries({ queryKey: ['chat-room', room.id] });
    qc.invalidateQueries({ queryKey: ['chat-rooms'] });
    qc.invalidateQueries({ queryKey: ['customers'] });
  };
  const link = useLinkRoomCustomer(room.id, {
    onSuccess: async (newCustomerId) => { await gfin.update({ customerId: newCustomerId }); toast.success('ผูกลูกค้ากับห้องแล้ว'); },
    // สร้างลูกค้าสำเร็จแล้ว แต่ผูกห้องไม่สำเร็จ (network/409/etc.) — ลูกค้ามีอยู่จริงในระบบแล้ว
    // ต้องไม่ปล่อยให้เงียบ (RoomDossier.tsx มี handler แบบเดียวกันสำหรับ linkCreated)
    onError: (err, customerId) => toast.error('สร้างลูกค้าแล้ว แต่ผูกกับแชทไม่สำเร็จ', {
      description: getErrorMessage(err),
      action: { label: 'ลองผูกอีกครั้ง', onClick: () => link.mutate(customerId) },
    }),
  });
  const missing = gfin.preview?.missingFields ?? [];
  const [draft, setDraft] = useState({ occupation: app.occupationOverride ?? app.customer?.occupation ?? '', phone: '', birthDate: '' });

  /* ใบผูก placeholder ไว้ (ใบร่างเก่าก่อนแก้) = ยังไม่ใช่ลูกค้าจริง */
  const linkedReal = !!app.customerId && !(placeholderRoom && app.customerId === roomCustomer?.id);

  if (!linkedReal) {
    const ocrName = { prefix: ocr?.prefix ?? undefined, firstName: ocr?.firstName ?? undefined, lastName: ocr?.lastName ?? undefined, nationalId: ocr?.nationalId ?? undefined };
    const fbName = room.channel === 'FACEBOOK' && room.displayName ? { facebookName: room.displayName } : {};
    const canCreate = canCreateCustomer(user?.role);
    const canFill = canFillProspectContact(user?.role);
    const realRoomCustomer = roomCustomer && !placeholderRoom ? roomCustomer : null;
    return (
      <Group label="1 ลูกค้า">
        <p className="m-0 text-xs leading-relaxed text-muted-foreground">
          {placeholderRoom
            ? 'ห้องนี้มีแค่ผู้สนใจจากแชท (ชื่อโปรไฟล์ ยังไม่มีเบอร์/เลขบัตร) · หยิบรูปบัตรประชาชนจากแชท (ลากมาวาง หรือกดปุ่ม GFIN ข้างรูป) เลือกช่อง "บัตรประชาชน" แล้วให้ระบบอ่าน'
            : 'ห้องนี้ยังไม่ผูกลูกค้า · หยิบรูปบัตรประชาชนจากแชท (ลากมาวาง หรือกดปุ่ม GFIN ข้างรูป) เลือกช่อง "บัตรประชาชน" แล้วให้ระบบอ่าน'}
        </p>
        {idCardFile && !ocr && <Button size="sm" className="mt-2 w-full" disabled={gfin.busy} onClick={async () => { try { setOcr(await gfin.ocrIdCard(idCardFile.sourceMessageId!)); } catch { /* toast จาก hook */ } }}>อ่านบัตรจากรูปที่หยิบไว้</Button>}
        {ocr && (
          <div className="mt-2 rounded-lg border border-border bg-muted/40 p-2 text-xs leading-snug">
            <p className="m-0 font-semibold">อ่านบัตรแล้ว (OCR) · ตรวจทานก่อนบันทึก</p>
            <dl className="m-0 mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
              <dt className="text-muted-foreground">ชื่อ</dt><dd className="m-0">{[ocr.prefix, ocr.firstName, ocr.lastName].filter(Boolean).join(' ') || ocr.fullName || '-'}</dd>
              <dt className="text-muted-foreground">เลขบัตร</dt><dd className="m-0">{ocr.nationalId ?? '-'} {ocr.nationalId && (ocr.nationalIdValid ? '✓' : '✗ ตรวจอีกครั้ง')}</dd>
              <dt className="text-muted-foreground">วันเกิด</dt><dd className="m-0">{ocr.birthDate ? formatThaiDate(ocr.birthDate) : '-'}</dd>
              <dt className="text-muted-foreground">ที่อยู่</dt><dd className="m-0">{ocr.address ?? '-'}</dd>
            </dl>
            <p className="m-0 mt-1 text-muted-foreground">ข้อมูลที่ข้อความ 12 ข้อต้องใช้แต่บัตรไม่มี: อาชีพ · เบอร์โทร — {placeholderRoom ? 'กรอกเบอร์ในฟอร์มถัดไป อาชีพกรอกหลังผูกแล้ว' : 'กรอกในฟอร์มสร้างลูกค้า'}</p>
          </div>
        )}
        <div className="mt-2 grid gap-1.5">
          {realRoomCustomer && (
            <Button size="sm" disabled={gfin.busy} onClick={() => quietly(gfin.update({ customerId: realRoomCustomer.id }))}>ใช้ลูกค้าของห้องนี้ ({realRoomCustomer.name})</Button>
          )}
          {placeholderRoom && roomCustomer ? (
            <Button size="sm" disabled={!canFill} title={canFill ? undefined : 'เติมเบอร์ได้เฉพาะเจ้าของ ผู้จัดการสาขา ผู้จัดการการเงิน และฝ่ายขาย'} onClick={() => setFillOpen(true)}>เพิ่มเบอร์/ข้อมูลลูกค้า (คนเดิมจากแชท)</Button>
          ) : !realRoomCustomer && (
            <Button size="sm" disabled={!canCreate} title={canCreate ? undefined : 'สร้างลูกค้าได้เฉพาะเจ้าของ ผู้จัดการสาขา และฝ่ายขาย — ใช้ "ผูกกับลูกค้าเดิม" แทน'} onClick={() => setCreateOpen(true)}>สร้างลูกค้าและผูกห้อง</Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}>ผูกกับลูกค้าเดิม (ค้นหาจากเลขบัตร/เบอร์)</Button>
        </div>
        <CustomerCreateDialog open={createOpen} onOpenChange={setCreateOpen}
          initialValues={{ ...ocrName, birthDate: ocr?.birthDate ?? undefined, ...fbName }}
          initialAddressIdCard={ocr?.addressStructured as AddressData | undefined}
          context={<span>บันทึกแล้วจะผูกกับห้องแชทนี้และใบยื่น GFIN ให้เอง</span>}
          onCreated={(customer) => link.mutate(customer.id)}
          onUseExisting={(customer) => link.mutate(customer.id)} />
        {placeholderRoom && roomCustomer && (
          <CustomerCreateDialog mode="fill" fillCustomerId={roomCustomer.id} open={fillOpen} onOpenChange={setFillOpen}
            /* ชื่อจากบัตร (OCR) ชนะชื่อโปรไฟล์แชท — ข้อความ 12 ข้อต้องไปด้วยชื่อจริง ไม่ใช่ชื่อเฟซ */
            initialValues={{ ...(ocr?.firstName ? ocrName : { ...splitDisplayName(roomCustomer.name), nationalId: ocrName.nationalId }), ...fbName }}
            context={<span>อัปเกรดผู้สนใจจากแชทคนเดิมเป็นลูกค้า (ไม่สร้างคนใหม่) · บันทึกแล้วผูกกับใบยื่น GFIN ให้เอง</span>}
            onCreated={() => undefined}
            onFilled={(customer) => { refreshRoom(); quietly(gfin.update({ customerId: customer.id })); }}
            /* เบอร์ซ้ำกับคนเดิม → ผูกห้องกับคนนั้น (API รวมผู้สนใจของห้องเข้าคนที่เลือกให้) แล้วใช้คนนั้นในใบยื่น */
            onUseExisting={(customer) => link.mutate(customer.id)} />
        )}
        {/* ผูกสำเร็จแล้วห้องชี้ลูกค้าคนที่เลือก (รวมผู้สนใจของห้องเข้าไปแล้วถ้ามี) — อ่านห้องใหม่แล้วใช้คนนั้นในใบยื่น */}
        <LinkCustomerDialog open={linkOpen} onOpenChange={setLinkOpen} roomId={room.id} mergesProspect={placeholderRoom}
          onLinked={async () => {
            try {
              const fresh = await api.get(`/staff-chat/rooms/${room.id}`);
              const id = fresh.data?.customer?.id ?? fresh.data?.customerId;
              if (id) await gfin.update({ customerId: id });
            } catch (err) { toast.error(getErrorMessage(err)); }
          }} />
      </Group>
    );
  }

  const saveOccupation = () => quietly(gfin.update({ occupationOverride: draft.occupation.trim() }));
  const saveCustomer = (patch: { phone?: string; birthDate?: string }) => quietly(gfin.customerFields(patch));
  return (
    <Group label="1 ลูกค้า" right={<span>{app.customer?.name}</span>}>
      {missing.length === 0 ? <p className="m-0 text-xs text-primary">ข้อมูลครบสำหรับข้อความ 12 ข้อ</p> : <p className="m-0 text-xs text-warning-strong">ยังขาด: {missing.map(f => FIELD_LABELS[f]).join(' · ')}</p>}
      {missing.includes('occupation') && <div className="mt-2 flex gap-1.5"><Input aria-label="อาชีพ" value={draft.occupation} onChange={e => setDraft({ ...draft, occupation: e.target.value })} placeholder="เช่น พนักงานบริษัท" /><Button size="sm" disabled={!draft.occupation.trim() || gfin.busy} onClick={saveOccupation}>บันทึกอาชีพ</Button></div>}
      {missing.includes('occupation') && <p className="m-0 mt-1 text-xs leading-snug text-muted-foreground">อาชีพเก็บเฉพาะในใบยื่นนี้ ไม่แก้ข้อมูลลูกค้า</p>}
      {missing.includes('phone') && <div className="mt-2 flex gap-1.5"><Input aria-label="เบอร์โทร" inputMode="tel" value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} placeholder="0XXXXXXXXX" /><Button size="sm" disabled={!/^0\d{9}$/.test(draft.phone) || gfin.busy} onClick={() => saveCustomer({ phone: draft.phone })}>บันทึกเบอร์</Button></div>}
      {missing.includes('age') && <div className="mt-2 flex gap-1.5"><Input aria-label="วันเกิด" type="date" value={draft.birthDate} onChange={e => setDraft({ ...draft, birthDate: e.target.value })} /><Button size="sm" disabled={!draft.birthDate || gfin.busy} onClick={() => saveCustomer({ birthDate: draft.birthDate })}>บันทึกวันเกิด</Button></div>}
      <Button size="sm" className="mt-2.5 w-full" disabled={missing.length > 0} onClick={onNext}>ถัดไป: เครื่อง</Button>
    </Group>
  );
}
