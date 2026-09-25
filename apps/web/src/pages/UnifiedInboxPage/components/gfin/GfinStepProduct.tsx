import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/useDebounce';
import { Group } from '../RoomDossier';
import type { FinanceApplicationModel } from '../../hooks/useFinanceApplication';
import { productLabel, imeiTail, quietly } from './gfin';

interface Hit { id: string; name: string; brand: string; model: string; color: string | null; storage: string | null; status: string; category: string; branchName: string | null }
const STATUS: Record<string, string> = { IN_STOCK: 'พร้อมขาย', RESERVED: 'จองแล้ว' };
const HAND = (category: string | null) => (category === 'PHONE_USED' ? 'มือ 2' : 'มือ 1');

export default function GfinStepProduct({ gfin, onBack, onNext }: { gfin: FinanceApplicationModel; onBack: () => void; onNext: () => void }) {
  const app = gfin.current!;
  const [q, setQ] = useState('');
  const debounced = useDebounce(q, 350);
  const search = useQuery<Hit[]>({ queryKey: ['gfin-product-search', debounced], enabled: debounced.trim().length >= 2, queryFn: async () => (await api.get('/staff-chat/products/search', { params: { q: debounced.trim() } })).data });
  const hits = (search.data ?? []).filter(h => h.status === 'IN_STOCK' || h.status === 'RESERVED');
  /* spec §8: มือสองที่รูป 6 มุมครบ → ระบบเติมช่อง DEVICE_PHOTO ให้ตอนเลือกเครื่อง (ลบออกได้ในขั้นรูป) · ไม่ครบ → API 400 พร้อมข้อความชี้ให้ถ่ายเพิ่ม (toast จาก hook) */
  const pick = async (h: Hit) => {
    try { await gfin.update({ productId: h.id }); } catch { return; /* toast จาก hook */ }
    if (h.category === 'PHONE_USED') { try { await gfin.fromProduct(); } catch { /* toast แล้ว — ไปถ่ายเพิ่มในขั้นรูป */ } }
  };
  return (
    <Group label="2 เครื่อง">
      {app.product ? (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-2 text-xs leading-snug">
          <p className="m-0 font-semibold">{productLabel(app.product)}</p>
          <p className="m-0 text-muted-foreground">{HAND(app.product.category)} · {imeiTail(app.product.imeiSerial)} · {STATUS[app.product.status] ?? app.product.status}</p>
          <p className="m-0 mt-1 font-mono">{app.product.imeiSerial}</p>
          <button type="button" className="mt-1 text-primary" onClick={() => quietly(gfin.update({ productId: null }))}>เปลี่ยนเครื่อง</button>
        </div>
      ) : (
        <>
          <Input aria-label="ค้นหาเครื่องในสต๊อก" placeholder="พิมพ์ IMEI ท้าย 4 ตัว หรือชื่อรุ่น" value={q} onChange={e => setQ(e.target.value)} />
          <ul className="m-0 mt-2 max-h-56 list-none overflow-y-auto p-0">
            {hits.map(h => <li key={h.id}><button type="button" disabled={gfin.busy} onClick={() => quietly(pick(h))} className="w-full rounded-md px-2 py-1.5 text-left text-xs leading-snug hover:bg-muted"><span className="font-semibold">{[h.name, h.storage, h.color].filter(Boolean).join(' · ')}</span><br /><span className="text-muted-foreground">{HAND(h.category)} · {STATUS[h.status]}{h.branchName ? ` · ${h.branchName}` : ''}</span></button></li>)}
            {search.isSuccess && hits.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">ไม่พบเครื่องพร้อมขาย/จองที่ตรงคำค้น</li>}
          </ul>
        </>
      )}
      <p className="m-0 mt-2 text-xs leading-snug text-muted-foreground">ข้อ 8 ถึง 12 ในข้อความ (แบต กล่อง สายชาร์จ) ระบบใส่ "-" ให้เสมอ ไม่ต้องตอบ</p>
      <div className="mt-2.5 grid grid-cols-2 gap-1.5"><Button size="sm" variant="outline" onClick={onBack}>ย้อนกลับ</Button><Button size="sm" disabled={!app.productId} onClick={onNext}>ถัดไป: รูป</Button></div>
    </Group>
  );
}
