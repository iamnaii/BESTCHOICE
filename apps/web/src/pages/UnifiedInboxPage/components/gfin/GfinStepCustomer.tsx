import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Group } from '../RoomDossier';
import type { DossierRoom } from '../RoomDossier';
import LinkCustomerDialog from '../LinkCustomerDialog';
import CustomerCreateDialog from '@/components/customer/CustomerCreateDialog';
import { useLinkRoomCustomer } from '../../hooks/useLinkRoomCustomer';
import type { AddressData } from '@/components/ui/AddressForm';
import type { FinanceApplicationModel, OcrIdCard } from '../../hooks/useFinanceApplication';
import { FIELD_LABELS } from './gfin';
import { formatThaiDate } from '@/lib/date';

export default function GfinStepCustomer({ room, customerId, gfin, onNext }: { room: DossierRoom; customerId: string | null; gfin: FinanceApplicationModel; onNext: () => void }) {
  const qc = useQueryClient();
  const app = gfin.current!;
  const [ocr, setOcr] = useState<OcrIdCard | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const idCardFile = app.files.find(f => f.slot === 'ID_CARD' && f.sourceMessageId);
  const link = useLinkRoomCustomer(room.id, { onSuccess: async (newCustomerId) => { await gfin.update({ customerId: newCustomerId }); toast.success('ผูกลูกค้ากับห้องแล้ว'); } });
  const missing = gfin.preview?.missingFields ?? [];
  const [draft, setDraft] = useState({ occupation: app.customer?.occupation ?? '', phone: app.customer?.phone ?? '', birthDate: app.customer?.birthDate?.slice(0, 10) ?? '' });
  const saveField = useMutation({
    mutationFn: async (patch: Record<string, string>) => api.patch(`/customers/${app.customerId}`, patch),
    onSuccess: async () => { toast.success('บันทึกแล้ว'); await qc.invalidateQueries({ queryKey: ['room-gfin'] }); await qc.invalidateQueries({ queryKey: ['room-gfin-preview'] }); await qc.invalidateQueries({ queryKey: ['customers'] }); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  if (!app.customerId) return (
    <Group label="1 ลูกค้า">
      <p className="m-0 text-xs leading-relaxed text-muted-foreground">ห้องนี้ยังไม่ผูกลูกค้า · หยิบรูปบัตรประชาชนจากแชท (ลากมาวาง หรือกดปุ่ม GFIN ข้างรูป) เลือกช่อง "บัตรประชาชน" แล้วให้ระบบอ่าน</p>
      {idCardFile && !ocr && <Button size="sm" className="mt-2 w-full" disabled={gfin.busy} onClick={async () => { try { setOcr(await gfin.ocrIdCard(idCardFile.sourceMessageId!)); } catch { /* toast จาก hook */ } }}>อ่านบัตรจากรูปที่หยิบไว้</Button>}
      {ocr && (
        <div className="mt-2 rounded-lg border border-border bg-muted/40 p-2 text-xs leading-snug">
          <p className="m-0 font-semibold">อ่านบัตรแล้ว (OCR) · ตรวจทานก่อนสร้าง</p>
          <dl className="m-0 mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <dt className="text-muted-foreground">ชื่อ</dt><dd className="m-0">{[ocr.prefix, ocr.firstName, ocr.lastName].filter(Boolean).join(' ') || ocr.fullName || '-'}</dd>
            <dt className="text-muted-foreground">เลขบัตร</dt><dd className="m-0">{ocr.nationalId ?? '-'} {ocr.nationalId && (ocr.nationalIdValid ? '✓' : '✗ ตรวจอีกครั้ง')}</dd>
            <dt className="text-muted-foreground">วันเกิด</dt><dd className="m-0">{ocr.birthDate ? formatThaiDate(ocr.birthDate) : '-'}</dd>
            <dt className="text-muted-foreground">ที่อยู่</dt><dd className="m-0">{ocr.address ?? '-'}</dd>
          </dl>
          <p className="m-0 mt-1 text-muted-foreground">ข้อมูลที่ข้อความ 12 ข้อต้องใช้แต่บัตรไม่มี: อาชีพ · เบอร์โทร — กรอกในฟอร์มสร้างลูกค้า</p>
        </div>
      )}
      <div className="mt-2 grid gap-1.5">
        <Button size="sm" onClick={() => setCreateOpen(true)}>สร้างลูกค้าและผูกห้อง</Button>
        <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}>ผูกกับลูกค้าเดิม (ค้นหาจากเลขบัตร/เบอร์)</Button>
      </div>
      <CustomerCreateDialog open={createOpen} onOpenChange={setCreateOpen}
        initialValues={{ prefix: ocr?.prefix ?? undefined, firstName: ocr?.firstName ?? undefined, lastName: ocr?.lastName ?? undefined, nationalId: ocr?.nationalId ?? undefined, birthDate: ocr?.birthDate ?? undefined, ...(room.channel === 'FACEBOOK' && room.displayName ? { facebookName: room.displayName } : {}) }}
        initialAddressIdCard={ocr?.addressStructured as AddressData | undefined}
        context={<span>บันทึกแล้วจะผูกกับห้องแชทนี้และใบยื่น GFIN ให้เอง</span>}
        onCreated={(customer) => link.mutate(customer.id)}
        onUseExisting={(customer) => link.mutate(customer.id)} />
      <LinkCustomerDialog open={linkOpen} onOpenChange={setLinkOpen} roomId={room.id} mergesProspect={!!room.customer?.chatPlaceholder} onLinked={async () => { const fresh = await api.get(`/staff-chat/rooms/${room.id}`); const id = fresh.data?.customer?.id ?? fresh.data?.customerId; if (id) await gfin.update({ customerId: id }); }} />
    </Group>
  );

  return (
    <Group label="1 ลูกค้า" right={<span>{app.customer?.name}</span>}>
      {missing.length === 0 ? <p className="m-0 text-xs text-primary">ข้อมูลครบสำหรับข้อความ 12 ข้อ</p> : <p className="m-0 text-xs text-warning-strong">ยังขาด: {missing.map(f => FIELD_LABELS[f]).join(' · ')}</p>}
      {missing.includes('occupation') && <div className="mt-2 flex gap-1.5"><Input aria-label="อาชีพ" value={draft.occupation} onChange={e => setDraft({ ...draft, occupation: e.target.value })} placeholder="เช่น พนักงานบริษัท" /><Button size="sm" disabled={!draft.occupation.trim() || saveField.isPending} onClick={() => saveField.mutate({ occupation: draft.occupation.trim() })}>บันทึกอาชีพ</Button></div>}
      {missing.includes('phone') && <div className="mt-2 flex gap-1.5"><Input aria-label="เบอร์โทร" inputMode="tel" value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} placeholder="0XXXXXXXXX" /><Button size="sm" disabled={!/^0\d{8,9}$/.test(draft.phone) || saveField.isPending} onClick={() => saveField.mutate({ phone: draft.phone })}>บันทึกเบอร์</Button></div>}
      {missing.includes('age') && <div className="mt-2 flex gap-1.5"><Input aria-label="วันเกิด" type="date" value={draft.birthDate} onChange={e => setDraft({ ...draft, birthDate: e.target.value })} /><Button size="sm" disabled={!draft.birthDate || saveField.isPending} onClick={() => saveField.mutate({ birthDate: draft.birthDate })}>บันทึกวันเกิด</Button></div>}
      <Button size="sm" className="mt-2.5 w-full" disabled={missing.length > 0} onClick={onNext}>ถัดไป: เครื่อง</Button>
    </Group>
  );
}
