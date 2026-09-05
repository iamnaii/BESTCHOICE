import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarPlus,
  ExternalLink,
  Search,
  UserPlus,
  Megaphone,
  MessagesSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { getGeneratedAvatarUrl } from '@/lib/avatar';
import { formatChatTimestamp } from '@/lib/chat-time';
import ProductContextCard from './ProductContextCard';
import Customer360Panel from './Customer360Panel';
import LinkCustomerDialog from './LinkCustomerDialog';
import { ContractHeroCard, PaymentsTimeline, CallLogList, DeviceWarrantyCard, type SummaryContract } from './DossierCards';

/**
 * แผงขวาของกล่องข้อความ — โครงตามแผงแชทของ OBI (dossier.tsx) ที่เจ้าของเคาะ 2026-09-06:
 * หัว (อวาตาร์+ช่องทาง · ชื่อ · บรรทัดรอง · เปิดโปรไฟล์) → ปุ่มตั้งนัด → แท็บเม็ดยา 3 แท็บ
 *   1 ข้อมูลลูกค้า  = ใครมา · มาจากไหน · นัด · สินค้า · ช่องทาง  (สิ่งที่ต้องรู้ตอนคุย)
 *   2 สัญญา/ชำระ   = เงิน (สัญญา · ค่างวด · โทรทวง)
 *   3 ประกัน        = เครื่อง (ประกันศูนย์ + ประกันร้าน · เคลม)
 * ไม่มีผู้ดูแล ไม่มีโน้ตภายใน (เจ้าของตัด) · ไม่มีปุ่มส่งสินค้าซ้ำ (มีที่แถบพิมพ์แล้ว)
 *
 * บล็อกของแผงเดิม (สัญญา/ค่างวด/โทร/MDM/รับประกัน + ไดอะล็อกทั้งหมด) ยังใช้ของเดิมผ่าน
 * <Customer360Panel bare sections=[…]> — ไม่เขียนซ้ำ ไม่ทำฟีเจอร์เดิมหาย
 */

export interface DossierRoom {
  id: string;
  channel: string;
  displayName?: string | null;
  pictureUrl?: string | null;
  createdAt?: string;
  lastMessageAt?: string;
  totalMessages?: number;
  customer?: { id: string; name: string; phone?: string | null } | null;
  attribution?: {
    firstTouch?: string;
    lastTouch?: string | null;
    campaign?: { campaignId: string; campaignName: string; adName?: string | null; adPhotoUrl?: string | null } | null;
  } | null;
}

type TabKey = 'customer' | 'money' | 'device';

const channelLabel: Record<string, string> = {
  FACEBOOK: 'Facebook',
  LINE_FINANCE: 'LINE การเงิน',
  LINE_SHOP: 'LINE ร้าน',
  TIKTOK: 'TikTok',
  WEB: 'เว็บ',
};
const channelDot: Record<string, string> = {
  FACEBOOK: 'bg-[#0866FF]',
  LINE_FINANCE: 'bg-[#06C755]',
  LINE_SHOP: 'bg-[#06C755]',
  TIKTOK: 'bg-foreground',
  WEB: 'bg-muted-foreground',
};

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function fmtDateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })} · ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
}

/** กล่องหมวด — หัวหนา + ตัวนับในวงเล็บ + ลิงก์/ปุ่มขวา (Group ของ OBI) */
export function Group({
  label,
  count,
  right,
  children,
  className,
}: {
  label: string;
  count?: number | null;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-[10px] border border-border bg-card px-3 pb-3 pt-2.5', className)}>
      <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-bold text-foreground">
        <h3 className="m-0 text-[12.5px] font-bold">{label}</h3>
        {count != null && <span className="font-semibold text-muted-foreground">({count})</span>}
        {right && <span className="ml-auto text-xs font-semibold text-primary">{right}</span>}
      </div>
      {children}
    </section>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

/** ─── มาจากโฆษณา (ข้อมูลจาก PR-A: attribution.campaign) — รูปเป็นลิงก์ CDN หมดอายุได้ โหลดไม่ขึ้นซ่อนเอง */
function AdGroup({ room }: { room: DossierRoom }) {
  const camp = room.attribution?.campaign;
  const [imgBroken, setImgBroken] = useState(false);
  if (!camp) {
    return (
      <Group label="มาจากโฆษณา">
        <Hint>ทักเพจโดยตรง — ไม่ได้มาจากโฆษณา</Hint>
      </Group>
    );
  }
  const title = camp.adName || (camp.campaignName !== 'Auto-detected' ? camp.campaignName : '') || 'โฆษณา Facebook (ไม่มีชื่อ)';
  return (
    <Group label="มาจากโฆษณา">
      <div className="flex items-center gap-2.5">
        {camp.adPhotoUrl && !imgBroken ? (
          <a href={camp.adPhotoUrl} target="_blank" rel="noreferrer" title="เปิดรูปโฆษณาในแท็บใหม่" className="shrink-0">
            <img src={camp.adPhotoUrl} alt="" loading="lazy" onError={() => setImgBroken(true)} className="size-14 rounded-lg object-cover" />
          </a>
        ) : (
          <div className="grid size-14 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Megaphone className="size-5" />
          </div>
        )}
        <div className="min-w-0">
          <p className="m-0 truncate text-[12.5px] font-bold">{title}</p>
          <p className="m-0 text-xs text-muted-foreground">
            {camp.campaignId.length > 12 ? camp.campaignId.slice(0, 10) + '…' : camp.campaignId}
            {room.attribution?.lastTouch ? ' · ' + fmtDateTime(room.attribution.lastTouch) : ''}
          </p>
        </div>
      </div>
    </Group>
  );
}

/** ─── ช่องทางแชท — ห้องนี้ + ห้องพี่น้อง (cross-channel ต้องผูกลูกค้าก่อน) แบบ OBI:
 *  ยังไม่ผูก = ไม่รู้ว่ามีช่องทางอื่นไหม จึงไม่วาดแถว "ยังไม่ผูก LINE" ให้ทางเดียวคือผูกก่อน */
function ChannelsGroup({
  room,
  linked,
  onSelectRoom,
  onLink,
}: {
  room: DossierRoom;
  linked: boolean;
  onSelectRoom?: (id: string) => void;
  onLink: () => void;
}) {
  const crossQuery = useQuery({
    queryKey: ['cross-channel', room.id],
    queryFn: () => api.get(`/staff-chat/rooms/${room.id}/cross-channel`).then((r) => r.data?.data ?? r.data),
    enabled: linked,
  });
  const siblings: { id: string; channel: string; lastMessageAt?: string; messages?: { text: string }[] }[] =
    (linked && Array.isArray(crossQuery.data) ? crossQuery.data : []).filter((r) => r.id !== room.id);
  const name = room.customer?.name ?? room.displayName ?? 'ไม่ระบุชื่อ';
  return (
    <Group label="ช่องทางแชท" count={1 + siblings.length}>
      <div className="flex items-center gap-2 rounded-lg border border-primary bg-primary/10 px-2.5 py-2 text-xs">
        <span className={cn('size-2 shrink-0 rounded-full', channelDot[room.channel] ?? 'bg-muted-foreground')} />
        <div className="min-w-0">
          <p className="m-0 truncate font-semibold">{channelLabel[room.channel] ?? room.channel} · {name}</p>
          <p className="m-0 text-muted-foreground">ห้องที่กำลังเปิดอยู่</p>
        </div>
      </div>
      {siblings.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelectRoom?.(s.id)}
          className="mt-1.5 flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-left text-xs hover:bg-muted"
        >
          <span className={cn('size-2 shrink-0 rounded-full', channelDot[s.channel] ?? 'bg-muted-foreground')} />
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate font-semibold">{channelLabel[s.channel] ?? s.channel}</p>
            <p className="m-0 truncate text-muted-foreground">{s.messages?.[0]?.text || 'ยังไม่มีข้อความ'}</p>
          </div>
          <span className="text-muted-foreground">›</span>
        </button>
      ))}
      {!linked && (
        <>
          <p className="mb-2 mt-2 text-xs leading-relaxed text-muted-foreground">
            ห้องนี้ยังไม่ได้ผูกกับลูกค้า จึงยังไม่รู้ว่าลูกค้ารายนี้มีแชทช่องทางอื่นอีกหรือไม่
          </p>
          <Button variant="outline" size="sm" className="w-full" onClick={onLink}>
            <Search className="mr-1.5 size-3.5" /> ผูกห้องนี้กับลูกค้าเพื่อดูช่องทางอื่น
          </Button>
        </>
      )}
    </Group>
  );
}

/** ─── ตรวจประกันจากเลขเครื่อง — ใช้ได้แม้ยังไม่ผูก (repair-tickets/warranty-lookup?imei=) */
function ImeiLookup() {
  const [imei, setImei] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['warranty-lookup', submitted],
    queryFn: () => api.get('/repair-tickets/warranty-lookup', { params: { imei: submitted } }).then((r) => r.data?.data ?? r.data),
    enabled: !!submitted && submitted.length >= 4,
    retry: false,
  });
  const devices: LookupDevice[] = Array.isArray(q.data?.devices) ? q.data.devices : [];
  const customerName: string | undefined = q.data?.customer?.name ?? undefined;
  const days = (n: number | null | undefined) =>
    n == null ? null : n > 0 ? `เหลือ ${n} วัน` : 'หมดแล้ว';
  return (
    <Group label="ประกัน">
      <div className="rounded-[10px] border border-dashed border-border bg-muted/40 p-3">
        <div className="flex items-start gap-2 text-xs text-foreground/80">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-border bg-card"><Search className="size-3.5" /></span>
          <div>
            <p className="m-0 text-[12.5px] font-bold text-foreground">ตรวจประกันจากเลขเครื่อง</p>
            ยังไม่ผูกลูกค้าก็ตรวจได้ — ลูกค้าส่ง IMEI/Serial มาในแชท ก็อปมาวางได้เลย
          </div>
        </div>
        <form
          className="mt-2.5 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(imei.trim());
          }}
        >
          <input
            value={imei}
            onChange={(e) => setImei(e.target.value)}
            placeholder="IMEI 15 หลัก หรือ Serial"
            aria-label="IMEI หรือ Serial"
            className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <Button type="submit" size="sm" disabled={imei.trim().length < 4 || q.isFetching}>
            ตรวจ
          </Button>
        </form>
        {q.isFetching && <p className="mb-0 mt-2 text-xs text-muted-foreground">กำลังตรวจ…</p>}
        {q.isError && (
          <p className="mb-0 mt-2 text-xs text-destructive">
            {(q.error as any)?.response?.data?.message ?? 'ตรวจไม่ได้ — ลองใหม่อีกครั้ง'}
          </p>
        )}
        {q.isSuccess && devices.length === 0 && <p className="mb-0 mt-2 text-xs text-muted-foreground">ไม่พบเครื่องเลขนี้ในระบบ</p>}
        {devices.map((d, i) => (
          <div key={i} className="mt-2 rounded-lg border border-border bg-card p-2.5 text-xs">
            <p className="m-0 font-bold">{[d.product?.brand, d.product?.model].filter(Boolean).join(' ') || 'เครื่อง'}</p>
            <p className="m-0 text-muted-foreground">
              {d.product?.imeiSerial ? `IMEI/Serial ${d.product.imeiSerial}` : ''}
              {customerName ? ` · ${customerName}` : ''}
              {d.contract?.contractNumber ? ` · สัญญา ${d.contract.contractNumber}` : ' · ขายสด'}
            </p>
            <p className="m-0 text-muted-foreground">
              ประกันศูนย์ {days(d.warrantyWindows?.mfrWarranty) ?? '—'} · ประกันร้าน {days(d.warrantyWindows?.shopWarranty) ?? 'ไม่มี'}
              {d.warrantyWindows?.sevenDayDefect != null && d.warrantyWindows.sevenDayDefect > 0
                ? ` · เปลี่ยนเครื่องได้อีก ${d.warrantyWindows.sevenDayDefect} วัน`
                : ''}
            </p>
          </div>
        ))}
      </div>
    </Group>
  );
}

/** รูปผลลัพธ์ของ GET /repair-tickets/warranty-lookup (repair-warranty.service.ts) — ตัวเลขใน warrantyWindows = วันที่เหลือ */
interface LookupDevice {
  product: { id: string; brand?: string | null; model?: string | null; imeiSerial?: string | null } | null;
  contract: { id: string; contractNumber: string; status: string } | null;
  warrantyWindows?: { sevenDayDefect: number | null; shopWarranty: number | null; mfrWarranty: number | null };
}

interface RoomDossierProps {
  room: DossierRoom | null | undefined;
  customerId: string | null;
  activeRoomId?: string | null;
  onSelectRoom?: (roomId: string) => void;
}

export default function RoomDossier({ room, customerId, activeRoomId, onSelectRoom }: RoomDossierProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('customer');
  // เปิดห้องใหม่ → กลับแท็บ 1 เสมอ (สิ่งที่ต้องรู้ก่อนพิมพ์คำแรก)
  const [tabRoom, setTabRoom] = useState<string | null>(null);
  if (room?.id && tabRoom !== room.id) {
    setTabRoom(room.id);
    setTab('customer');
  }
  const [linkOpen, setLinkOpen] = useState(false);

  const linked = !!customerId;
  // endpoint + คีย์เดียวกับแผงเดิม (customer-chat-summary) — แคชร่วมกัน ไดอะล็อกของแผงเดิม invalidate แล้วเราเห็นด้วย
  const summaryQuery = useQuery({
    queryKey: ['customer-chat-summary', customerId],
    queryFn: () => api.get(`/customers/${customerId}/chat-summary`).then((r) => r.data?.data ?? r.data),
    enabled: linked,
  });
  const contracts: SummaryContract[] = Array.isArray(summaryQuery.data?.activeContracts) ? summaryQuery.data.activeContracts : [];
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
  const devicesCount = useMemo(
    () => contracts.filter((c) => c.product?.warrantyExpireDate || c.shopWarrantyEndDate).length,
    [contracts],
  );

  if (!room) {
    return (
      <aside className="flex h-full w-80 shrink-0 flex-col items-center justify-center border-l border-border p-6 text-center" aria-label="ข้อมูลลูกค้า">
        <MessagesSquare className="mb-3 size-7 text-muted-foreground/30" />
        <p className="text-xs font-semibold text-foreground/50">ข้อมูลลูกค้า</p>
        <p className="mt-1 max-w-[180px] text-[11px] leading-relaxed text-muted-foreground/50">เลือกแชทเพื่อดูข้อมูลลูกค้า สัญญา และประกัน</p>
      </aside>
    );
  }

  const name = room.customer?.name ?? room.displayName ?? 'ไม่ระบุชื่อ';
  const avatar: string | undefined = room.pictureUrl || getGeneratedAvatarUrl(room.id) || undefined;
  const metaLine = linked
    ? [room.customer?.phone ? `โทร ${room.customer.phone}` : null, room.createdAt ? `เริ่มคุย ${fmtDate(room.createdAt)}` : null].filter(Boolean).join(' · ')
    : 'ยังไม่ได้ผูกกับลูกค้าในระบบ';

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'customer', label: 'ข้อมูลลูกค้า' },
    { key: 'money', label: 'สัญญา/ชำระ', count: linked ? contracts.length || undefined : undefined },
    { key: 'device', label: 'ประกัน', count: linked ? devicesCount || undefined : undefined },
  ];

  const openCreateCustomer = () => {
    const params = new URLSearchParams({ new: '1' });
    if (room.displayName) params.set('name', room.displayName);
    params.set('fromRoomId', room.id);
    navigate(`/customers?${params.toString()}`);
  };

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-card" aria-label="ข้อมูลลูกค้า">
      {/* หัว */}
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-border px-3.5 pb-3 pt-3.5">
        <div className="flex items-start gap-2.5">
          <div className="relative size-11 shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-border">
            <img src={avatar} alt="" className="size-full object-cover" />
            <span className={cn('absolute -bottom-0.5 -right-0.5 size-4 rounded-full border-2 border-card', channelDot[room.channel] ?? 'bg-muted-foreground')} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 truncate text-sm font-bold leading-6">{name}</h2>
            <p className="m-0 text-xs leading-snug text-muted-foreground">{metaLine}</p>
          </div>
          <button
            type="button"
            title={linked ? 'เปิดโปรไฟล์ลูกค้าเต็มหน้า' : 'ผูกลูกค้าก่อนถึงเปิดโปรไฟล์ได้'}
            aria-label="เปิดโปรไฟล์ลูกค้าเต็มหน้า"
            disabled={!linked}
            onClick={() => customerId && navigate(`/customers/${customerId}`)}
            className="grid size-7 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <ExternalLink className="size-3.5" />
          </button>
        </div>
        {/* ปุ่มด่วนอันเดียว — "ส่งสินค้า" มีที่แถบพิมพ์แล้ว ไม่ทำซ้ำ · นัดเป็นของห้อง ตั้งได้จากทุกแท็บ */}
        <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/todos')}>
          <CalendarPlus className="mr-1.5 size-3.5" /> ตั้งนัด
        </Button>
      </div>

      {/* แท็บเม็ดยา */}
      <div role="tablist" className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border px-3 pb-2 pt-2.5">
        {tabs.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={cn(
                'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition-colors',
                on
                  ? 'border-primary bg-primary text-primary-foreground ring-[3px] ring-primary/15'
                  : 'border-border bg-card text-foreground/80 hover:bg-muted',
              )}
            >
              {t.label}
              {t.count != null && <span className={cn('font-semibold', on ? 'opacity-90' : 'text-muted-foreground')}>{t.count}</span>}
            </button>
          );
        })}
      </div>

      {/* เนื้อหาแท็บ */}
      <div className="flex-1 overflow-y-auto bg-muted/30">
        {tab === 'customer' && (
          <div className="flex flex-col gap-2.5 p-2.5">
            <Group label="ข้อมูลลูกค้า">
              {linked ? (
                <button
                  type="button"
                  onClick={() => navigate(`/customers/${customerId}`)}
                  className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-left text-xs font-semibold hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">{room.customer?.name}</span>
                  <span className="text-muted-foreground">›</span>
                </button>
              ) : (
                <div className="rounded-[10px] border border-dashed border-warning bg-warning/10 p-3 text-xs leading-relaxed text-foreground">
                  <p className="m-0 font-bold">⚠ ห้องนี้ยังไม่ได้ผูกกับลูกค้า</p>
                  <p className="m-0 text-foreground/80">ข้อมูลสัญญา การชำระ และแชทช่องทางอื่นของคนเดียวกัน จะใช้งานไม่ได้จนกว่าจะผูก — ปกติทำตอนทำสัญญาที่ร้าน</p>
                  <div className="mt-2 flex gap-1.5">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setLinkOpen(true)}>
                      <Search className="mr-1 size-3.5" /> ค้นหาลูกค้าเดิม
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={openCreateCustomer}>
                      <UserPlus className="mr-1 size-3.5" /> สร้างลูกค้าใหม่
                    </Button>
                  </div>
                </div>
              )}
              {/* ค่าของ "ห้อง" อยู่นอกกล่องลูกค้า (OBI PROTO-17) — จำเป็นที่สุดตอนยังไม่มีลูกค้าให้ดู */}
              <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">เริ่มคุยเมื่อ</dt>
                <dd className="m-0 tabular-nums">{fmtDateTime(room.createdAt) || '—'}</dd>
                <dt className="text-muted-foreground">ข้อความ</dt>
                <dd className="m-0 tabular-nums">
                  {room.totalMessages ?? 0}
                  {room.lastMessageAt ? ` · ล่าสุด ${formatChatTimestamp(room.lastMessageAt)}` : ''}
                </dd>
              </dl>
            </Group>

            <AdGroup room={room} />

            <Group label="นัดหมาย" count={0} right={<button type="button" className="text-primary" onClick={() => navigate('/todos')}>＋ ตั้งนัด</button>}>
              <Hint>ยังไม่มีนัดในห้องนี้</Hint>
            </Group>

            <Group label="สินค้าที่กำลังคุย">
              <ProductContextCard roomId={room.id} empty={<Hint>ยังไม่พบรุ่นในแชทนี้ — เลือกส่งได้จากปุ่มสินค้าที่แถบพิมพ์</Hint>} />
            </Group>

            <ChannelsGroup room={room} linked={linked} onSelectRoom={onSelectRoom} onLink={() => setLinkOpen(true)} />
          </div>
        )}

        {tab === 'money' && (
          <div className="flex flex-col gap-2.5 p-2.5">
            {linked ? (
              <>
                <Group label="สัญญา" count={contracts.length}>
                  {contracts.length === 0 && <Hint>ไม่มีสัญญาที่ใช้งาน</Hint>}
                  <div className="flex flex-col gap-2">
                    {contracts.map((c) => (
                      <ContractHeroCard key={c.id} contract={c} overdueAmount={contracts.length === 1 ? num(summaryQuery.data?.totalOutstanding) || undefined : undefined} />
                    ))}
                  </div>
                </Group>
                <PaymentsTimeline payments={Array.isArray(summaryQuery.data?.recentPayments) ? summaryQuery.data.recentPayments : []} contractId={contracts[0]?.id} />
                <CallLogList logs={Array.isArray(summaryQuery.data?.callLogs) ? summaryQuery.data.callLogs : []} />
                {/* ปุ่ม "ดำเนินการ" + ไดอะล็อกของแผงเดิม (ส่งลิงก์ชำระ · บันทึกติดต่อ+นัดชำระ · ล็อกเครื่อง · PDF) */}
                <div className="rounded-[10px] border border-border bg-card">
                  <Customer360Panel bare customerId={customerId} activeRoomId={activeRoomId} onSelectRoom={onSelectRoom} sections={['actions']} />
                </div>
              </>
            ) : (
              <>
                <Group label="สัญญา"><Hint>ยังไม่มี — ผูกลูกค้าแล้วจะเห็นสัญญาและค่างวด</Hint></Group>
                <Group label="ประวัติการชำระ"><Hint>ยังไม่มี — ผูกลูกค้าแล้วจะเห็นสัญญาและค่างวด</Hint></Group>
                <Group label="บันทึกการโทร"><Hint>ยังไม่มี — ห้องนี้ยังไม่มีเบอร์และยังไม่ผูกลูกค้า</Hint></Group>
              </>
            )}
          </div>
        )}

        {tab === 'device' && (
          <div className="flex flex-col gap-2.5 p-2.5">
            {linked ? (
              <>
                <Group label="ประกัน" count={contracts.length || undefined}>
                  {contracts.length === 0 && <Hint>ยังไม่มีเครื่องในสัญญาที่ใช้งาน — ตรวจจากเลขเครื่องได้ด้านล่าง</Hint>}
                  <div className="flex flex-col gap-2">
                    {contracts.map((c) => <DeviceWarrantyCard key={c.id} contract={c} />)}
                  </div>
                </Group>
                {/* สถานะ MDM ของแผงเดิม (ล็อก/ปลดล็อกเครื่อง) */}
                <div className="rounded-[10px] border border-border bg-card">
                  <Customer360Panel bare customerId={customerId} activeRoomId={activeRoomId} onSelectRoom={onSelectRoom} sections={['mdm']} />
                </div>
                {contracts.length === 0 && <ImeiLookup />}
              </>
            ) : (
              <ImeiLookup />
            )}
          </div>
        )}
      </div>

      <LinkCustomerDialog open={linkOpen} onOpenChange={setLinkOpen} roomId={room.id} />
    </aside>
  );
}
