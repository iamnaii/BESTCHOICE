import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Group } from '../RoomDossier';
import type { DossierRoom } from '../RoomDossier';
import type { FinanceApplicationModel } from '../../hooks/useFinanceApplication';
import { STATUS_LABEL, quietly } from './gfin';
import GfinStepCustomer from './GfinStepCustomer';
import GfinStepProduct from './GfinStepProduct';
import GfinStepFiles from './GfinStepFiles';
import GfinStepMessage from './GfinStepMessage';
import GfinStatusCard from './GfinStatusCard';
import GfinLineGroupLine from './GfinLineGroupLine';
import { formatThaiDateShort } from '@/lib/date';

export interface GfinTabProps { room: DossierRoom; customerId: string | null; gfin?: FinanceApplicationModel; onPickSlotForMessage?: (messageId: string) => void }
const STEP_LABEL = ['ลูกค้า', 'เครื่อง', 'รูป', 'ข้อความ'];

export default function GfinTab({ room, customerId, gfin, onPickSlotForMessage }: GfinTabProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | null>(null);       // null = ตามระบบ (gfin.step) · ผู้ใช้กดย้อน/ข้ามได้
  const [dropFiles, setDropFiles] = useState<File[] | null>(null);
  useEffect(() => { setStep(null); }, [gfin?.current?.id]);
  useEffect(() => {
    const handler = (e: Event) => setDropFiles((e as CustomEvent<File[]>).detail);
    window.addEventListener('gfin-drop-files', handler);
    return () => window.removeEventListener('gfin-drop-files', handler);
  }, []);
  if (!gfin) return null;
  const app = gfin.current;
  const active = step ?? gfin.step;

  if (!app) return (
    <div className="flex flex-col gap-2.5 p-2.5">
      <Group label="ใบยื่นใหม่">
        <p className="m-0 text-sm font-semibold leading-snug">รวมชุดเช็คแล้วส่งเข้ากลุ่มไลน์ GFIN ในคลิกเดียว</p>
        <p className="m-0 mt-1 text-xs leading-snug text-muted-foreground">ข้อความ 12 ข้อ + ลิงก์เอกสารทั้งชุด · ลูกค้าไม่เห็น</p>
        <Button className="mt-2.5 w-full" disabled={gfin.busy} onClick={() => quietly(gfin.start())}>เริ่มใบยื่น</Button>
      </Group>
      <Group label="ประวัติใบยื่น" count={gfin.history.length}>
        {gfin.history.length === 0
          ? <p className="m-0 text-xs leading-relaxed text-muted-foreground">ลูกค้าคนนี้ยังไม่เคยยื่น GFIN · ใบที่ส่งแล้วจะเรียงที่นี่พร้อมผล</p>
          : <ul className="m-0 list-none p-0 text-xs">{gfin.history.map(h => <li key={h.id} className="flex justify-between py-1"><span>{h.number} · {formatThaiDateShort(h.createdAt)}</span><span className="font-semibold">{STATUS_LABEL[h.status]}</span></li>)}</ul>}
      </Group>
      <Group label="กลุ่มไลน์ปลายทาง"><GfinLineGroupLine status={gfin.lineGroup} /></Group>
    </div>
  );

  if (app.status !== 'DRAFT') return <GfinStatusCard app={app} gfin={gfin} history={gfin.history} onAddMore={() => setStep(3)} showFilesStep={step === 3} onCloseFiles={() => setStep(null)} onPickSlotForMessage={onPickSlotForMessage} dropFiles={dropFiles} onDropFilesHandled={() => setDropFiles(null)} />;

  return (
    <div className="flex flex-col gap-2.5 p-2.5">
      <Group label="ใบยื่น (ร่าง)" right={<button type="button" className="text-destructive" onClick={() => quietly(gfin.cancel())} disabled={gfin.busy}>ยกเลิกใบยื่น</button>}>
        <p className="m-0 text-xs text-muted-foreground">ขั้น {active}/4</p>
        <ol className="m-0 mt-2 grid list-none grid-cols-4 gap-1 p-0" aria-label="ขั้นตอน">
          {STEP_LABEL.map((label, i) => { const n = (i + 1) as 1 | 2 | 3 | 4; const done = n < gfin.step; const on = n === active;
            return <li key={label}><button type="button" onClick={() => setStep(n)} aria-current={on ? 'step' : undefined}
              className={['w-full rounded-md border px-1 py-1 text-[11px] font-semibold leading-snug', on ? 'border-primary bg-primary text-primary-foreground' : done ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground'].join(' ')}>{n} {label}</button></li>; })}
        </ol>
      </Group>
      {active === 1 && <GfinStepCustomer room={room} customerId={customerId} gfin={gfin} onNext={() => setStep(2)} />}
      {active === 2 && <GfinStepProduct gfin={gfin} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
      {active === 3 && <GfinStepFiles gfin={gfin} onBack={() => setStep(2)} onNext={() => setStep(4)} dropFiles={dropFiles} onDropFilesHandled={() => setDropFiles(null)} />}
      {active === 4 && <GfinStepMessage gfin={gfin} onBack={() => setStep(3)} />}
    </div>
  );
}
