import CustomerAppointments from '@/components/appointments/CustomerAppointments';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import CloudCreditPicker from './CloudCreditPicker';
import ChatServiceRequestSection from './ChatServiceRequestSection';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ArrowLeft, Paperclip } from 'lucide-react';
import DossierDisclosure from './DossierDisclosure';
import ChatFollowUpDialog from './ChatFollowUpDialog';
import ChatHandoffDialog from './ChatHandoffDialog';
import ChatHandoffCard from './ChatHandoffCard';
import { useChatWorkSettings } from '../hooks/useChatWork';
import ChatSalesContext from './ChatSalesContext';
import { useEffect, useMemo, useRef, useState } from 'react';
import RoomCreditCard, { CreditFilePicker } from './RoomCreditCard';
import { CREDIT_MESSAGE_MIME } from './credit-statement';
import type { RoomCreditModel } from '../hooks/useRoomCredit';
import GfinTab from './gfin/GfinTab';
import { GFIN_MESSAGE_MIME, needsAttention, readSeen, markSeen } from './gfin/gfin';
import type { FinanceApplicationModel } from '../hooks/useFinanceApplication';
import { Link, useNavigate } from 'react-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ExternalLink,
  Search,
  UserPlus,
  Megaphone,
  MessagesSquare,
  Phone,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import RoomFollowUps from './RoomFollowUps';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { formatChatTimestamp } from '@/lib/chat-time';
import ProductContextCard from './ProductContextCard';
import Customer360Panel from './Customer360Panel';
import LinkCustomerDialog from './LinkCustomerDialog';
import CustomerCreateDialog, { splitDisplayName } from '@/components/customer/CustomerCreateDialog';
import { useLinkRoomCustomer, type LinkRoomResult } from '../hooks/useLinkRoomCustomer';
import { useAbsorbCustomer, useDismissSamePerson, type AbsorbArgs } from '../hooks/useProspectActions';
import { useAuth } from '@/contexts/AuthContext';
import { canCreateCustomer, canFillProspectContact } from '@/lib/constants';
import { toast } from 'sonner';
import { ContractHeroCard, PaymentsTimeline, CallLogList, DeviceWarrantyCard, type SummaryContract } from './DossierCards';
import { TodoForm } from '@/pages/TodosPage/components/TodoForm';
import type { Todo, AssigneeRef } from '@/pages/TodosPage/types';

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

/** โลโก้ช่องทางแชทของคำใบ้ "อาจเป็นคนเดียวกัน" — API ยุบ LINE_FINANCE/LINE_SHOP เป็น LINE แล้ว (`chatLogoOf`) */
export type SamePersonChannel = 'LINE' | 'FACEBOOK' | 'TIKTOK' | 'WEB';

/** คำใบ้ "อาจเป็นคนเดียวกัน" จาก GET /staff-chat/rooms/:id (สเปค 3.6 · สูงสุด 3 · ไม่รวมอัตโนมัติ) */
export interface PossibleSamePerson {
  customerId: string;
  name: string;
  /** `null` = คนที่ชื่อตรงกันและมีเบอร์แล้ว แต่ยังไม่เคยมีห้องแชท (same-person.service คืน null ตรง ๆ) */
  channel: SamePersonChannel | null;
  /** ช่องทางจริงของห้องล่าสุดของคนนั้น (เช่น `LINE_SHOP`) — ป้ายละเอียดกว่า `channel` · API เก่าไม่มีคีย์นี้ */
  channelDetail?: string | null;
  hasPhone: boolean;
  chatPlaceholder: boolean;
  createdAt: string;
  mergeDirection: 'absorb_current_into_other' | 'absorb_other_into_current' | 'none';
}

export interface DossierRoom {
  id: string;
  channel: string;
  displayName?: string | null;
  pictureUrl?: string | null;
  createdAt?: string;
  lastMessageAt?: string;
  totalMessages?: number;
  /** `chatPlaceholder` = ผู้สนใจอัตโนมัติจากแชท (API ตัดสินให้ — เว็บห้าม derive เอง) */
  customer?: { id: string; name: string; phone?: string | null; chatPlaceholder?: boolean } | null;
  possibleSamePerson?: PossibleSamePerson[];
  attribution?: {
    firstTouch?: string;
    lastTouch?: string | null;
    campaign?: { campaignId: string; campaignName: string; adName?: string | null; adPhotoUrl?: string | null } | null;
  } | null;
}

type TabKey = 'customer' | 'money' | 'device' | 'gfin';

const channelLabel: Record<string, string> = {
  FACEBOOK: 'Facebook',
  LINE_FINANCE: 'LINE การเงิน',
  LINE_SHOP: 'LINE ร้าน',
  TIKTOK: 'TikTok',
  WEB: 'เว็บ',
};
/** ป้ายของโลโก้ช่องทาง (คนละชุดกับ `channelLabel` ที่ key ด้วยช่องทางห้องจริง เช่น LINE_SHOP) */
const chatLogoLabel: Record<SamePersonChannel, string> = {
  LINE: 'LINE',
  FACEBOOK: 'Facebook',
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
    <section className={cn('inbox-dossier-group rounded-[10px] border border-border bg-card px-3 pb-3 pt-2.5', className)}>
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

/** R-1: SALES กดรวม "ผู้สนใจอีกคน" เข้าห้องนี้ แต่ห้องของคนนั้นมีพนักงานคนอื่นดูแล (403 จาก assertActorMayAbsorb)
 *  ทางที่ทำได้จริง: คนดูแลห้องนั้น (ผ่านด่านเพราะเป็นห้องของตัวเอง — กดรวมจากคำใบ้หรือ "ผูกกับลูกค้าเดิม" ในห้องนั้น)
 *  หรือ role ที่ด่านนี้ไม่ตรวจ = @Roles ของ absorb-into ที่ไม่ใช่ SALES (OWNER/BRANCH_MANAGER/FINANCE_MANAGER) */
const ABSORB_OTHER_HELD_MSG =
  'ผู้สนใจคนนั้นมีห้องแชทที่พนักงานคนอื่นดูแลอยู่ — ให้คนดูแลห้องนั้น หรือเจ้าของ/ผู้จัดการสาขา/ผู้จัดการการเงิน กดรวมแทน';

/** ป้ายช่องทางของคำใบ้: ช่องทางจริง (LINE ร้าน) ก่อน → โลโก้ (LINE) → ไม่มีทั้งคู่/ไม่รู้จัก = ไม่มีป้าย (R42) */
function hintChannelLabel(p: PossibleSamePerson): string | null {
  return (p.channelDetail ? channelLabel[p.channelDetail] : undefined) ?? (p.channel ? chatLogoLabel[p.channel] : undefined) ?? null;
}

/** ท้ายคำใบ้: `createdAt` = วันที่สร้างลูกค้าคนนั้น — "ทักเมื่อ" จริงเฉพาะคนที่มีห้องแชท
 *  ไม่มีห้องเลย (channel + channelDetail ว่าง — มักเป็นลูกค้าหน้าร้านที่มีเบอร์) → "อยู่ในระบบตั้งแต่" */
/** วันที่ท้ายคำใบ้ = `createdAt` ของแถวลูกค้า (ไม่ใช่วันที่ห้องแชท) — "ทักเมื่อ" จริงเฉพาะผู้สนใจอัตโนมัติ
 *  (แถวถูกสร้างตอนทักแชทครั้งแรก) · คนอื่น (เช่น ลูกค้าหน้าร้านที่ผูก LINE ทีหลัง) ใช้ "อยู่ในระบบตั้งแต่" */
function hintSinceLabel(p: PossibleSamePerson): string {
  return `${p.chatPlaceholder ? 'ทักเมื่อ' : 'อยู่ในระบบตั้งแต่'} ${fmtDate(p.createdAt) || '—'}`;
}

/** ─── คำใบ้ "อาจเป็นคนเดียวกัน" (สเปค 3.6) — ชุดเดียวใช้ทั้งการ์ดผู้สนใจและห้องของลูกค้าจริง
 *  `currentIsProspect` = เจ้าของห้องนี้เป็นผู้สนใจอัตโนมัติ (ธงจาก API) — ทิศ "ดูดห้องนี้เข้าคนอื่น" มีความหมายเฉพาะตอนนั้น */
function SamePersonHints({ hints, customerId, currentIsProspect, onMerge, onDismiss, busy }: {
  hints: PossibleSamePerson[];
  customerId: string;
  currentIsProspect: boolean;
  onMerge: (args: AbsorbArgs) => void;
  onDismiss: (customerId: string) => void;
  busy: boolean;
}) {
  return (
    <>
      {hints.slice(0, 3).map((p) => {
        /* ทิศทางรวมต้องระบุชัดทั้งสองค่า — ค่าที่ไม่รู้จัก (API เพิ่มทิศทางใหม่) ต้องไม่มีปุ่มรวม
           ไม่ใช่ตกไปทิศตรงข้ามเงียบ ๆ อย่าง ternary สองทาง (รวมผิดทิศ = ดูดคนจริงเข้าผู้สนใจ)
           ห้องลูกค้าจริงที่ได้ทิศ "ดูดห้องนี้เข้าคนอื่น" = ข้อมูลผิดรูป (API รวมได้เฉพาะต้นทางที่เป็นผู้สนใจ) → ไม่มีปุ่มเช่นกัน */
        const merge =
          p.mergeDirection === 'absorb_current_into_other' && currentIsProspect
            ? { placeholderId: customerId, targetId: p.customerId }
            : p.mergeDirection === 'absorb_other_into_current'
              ? { placeholderId: p.customerId, targetId: customerId }
              : null;
        const channel = hintChannelLabel(p);
        return (
          <div key={p.customerId} className="mt-2 rounded-lg border border-primary/35 bg-primary/5 px-2.5 py-2 text-xs leading-snug">
            <p className="m-0">
              <Users className="mr-1 inline size-3.5 text-primary" aria-hidden="true" />
              อาจเป็นคนเดียวกับ <span className="font-semibold">{p.name}</span> — {channel ? `${channel} · ` : ''}{p.hasPhone ? 'มีเบอร์' : 'ยังไม่มีเบอร์'} · {hintSinceLabel(p)}
            </p>
            <div className="mt-2 flex items-center gap-1.5">
              {merge ? (
                <Button variant="primary" size="sm" disabled={busy} onClick={() => onMerge(merge)}>
                  รวมเป็นคนเดียวกัน
                </Button>
              ) : p.mergeDirection === 'none' ? (
                <span className="text-muted-foreground">ตรวจสอบเอง</span>
              ) : null}
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => onDismiss(p.customerId)}>ไม่ใช่</Button>
            </div>
          </div>
        );
      })}
    </>
  );
}

/** ─── การ์ดผู้สนใจจากแชท (mockup 1388f98e บอร์ด 1-2) — ทุกห้องมีเจ้าของตั้งแต่ทักมา กล่องเหลือง "ยังไม่ผูก" จึงเหลือเฉพาะห้องที่ไม่มีเจ้าของจริง ๆ */
function ProspectCard({ canFill, onFill, onLink, hints }: {
  room: DossierRoom;
  canFill: boolean;
  onFill: () => void;
  onLink: () => void;
  /** กล่องคำใบ้ (SamePersonHints) — ผู้เรียกประกอบให้ ใช้ชุดเดียวกับห้องลูกค้าจริง */
  hints: React.ReactNode;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold leading-4 text-primary">ผู้สนใจจากแชท</span>
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold leading-4 text-muted-foreground">ยังไม่มีเบอร์</span>
      </div>
      <div className="inbox-dossier-link-actions mt-2">
        <Button
          variant="primary"
          size="sm"
          className="flex-1"
          disabled={!canFill}
          title={canFill ? undefined : 'เติมเบอร์ได้เฉพาะเจ้าของ ผู้จัดการสาขา ผู้จัดการการเงิน และฝ่ายขาย'}
          onClick={onFill}
        >
          <Phone className="mr-1 size-3.5" /> เพิ่มเบอร์/ข้อมูล
        </Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={onLink}>
          <Search className="mr-1 size-3.5" /> ผูกกับลูกค้าเดิม
        </Button>
      </div>
      {hints}
    </>
  );
}

/** ─── ช่องทางแชท — ห้องนี้ + ห้องพี่น้อง (cross-channel ต้องผูกลูกค้าก่อน) แบบ OBI:
 *  ยังไม่ผูก = ไม่รู้ว่ามีช่องทางอื่นไหม จึงไม่วาดแถว "ยังไม่ผูก LINE" ให้ทางเดียวคือผูกก่อน */
function ChannelsGroup({
  room,
  linked,
  placeholder,
  onSelectRoom,
  onLink,
}: {
  room: DossierRoom;
  linked: boolean;
  placeholder: boolean;
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
      {placeholder && (
        <p className="mb-0 mt-2 text-xs leading-relaxed text-muted-foreground">เพิ่มเบอร์หรือผูกลูกค้าเดิมเพื่อดูแชทช่องทางอื่น</p>
      )}
      {!linked && !placeholder && (
        <>
          <p className="mb-2 mt-2 text-xs leading-relaxed text-muted-foreground">
            ผูกลูกค้าเพื่อดูแชทช่องทางอื่น
          </p>
          <Button variant="outline" size="sm" className="w-full" onClick={onLink}>
            <Search className="mr-1.5 size-3.5" /> ผูกห้องนี้กับลูกค้าเพื่อดูช่องทางอื่น
          </Button>
        </>
      )}
    </Group>
  );
}

/** เจ้าของห้องแบบไหน — หัวช่องตรวจ IMEI พูดต่างกัน (M-W5) */
type ImeiLookupOwner = 'none' | 'prospect' | 'customer';
/** ส่วนนำของหัวช่องตรวจ IMEI — ห้องลูกค้าจริงไม่มี ("ยังไม่…ก็ตรวจได้" เป็นเท็จเมื่อผูกและมีเบอร์แล้ว) */
const IMEI_LOOKUP_LEAD: Record<ImeiLookupOwner, string | null> = {
  none: 'ยังไม่ผูกลูกค้าก็ตรวจได้',
  prospect: 'ยังไม่มีเบอร์ก็ตรวจได้',
  customer: null,
};

/** ─── ตรวจประกันจากเลขเครื่อง — ใช้ได้แม้ยังไม่ผูก (repair-tickets/warranty-lookup?imei=)
 *  `owner`: ห้องไม่มีเจ้าของ · ผู้สนใจจากแชท (มีเจ้าของแล้วแต่ยังไม่มีเบอร์) · ลูกค้าจริงที่ยังไม่มีสัญญา */
function ImeiLookup({ owner }: { owner: ImeiLookupOwner }) {
  const lead = IMEI_LOOKUP_LEAD[owner];
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
            {lead ? `${lead} — ` : ''}ลูกค้าส่ง IMEI/Serial มาในแชท ก็อปมาวางได้เลย
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
  onClose?: () => void;
  credit?: RoomCreditModel;
  creditFocus?: { roomId: string; tick: number } | null;
  gfin?: FinanceApplicationModel;
  gfinFocus?: { roomId: string; tick: number } | null;
  onPickSlot?: (messageId: string) => void;
  room: DossierRoom | null | undefined;
  customerId: string | null;
  activeRoomId?: string | null;
  onSelectRoom?: (roomId: string) => void;
}

export default function RoomDossier({ onClose, room, customerId, activeRoomId, onSelectRoom, credit, creditFocus, gfin, gfinFocus, onPickSlot }: RoomDossierProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('customer');
  const creditRef = useRef<HTMLDivElement>(null);
  const creditDragDepth = useRef(0);
  const [creditDragging, setCreditDragging] = useState(false);
  const [creditFlash, setCreditFlash] = useState(false);
  const [creditExpanded, setCreditExpanded] = useState(false);
  useEffect(() => {
    setCreditExpanded(!!(credit?.files.length || credit?.analysis || credit?.error || credit?.busy));
  }, [room?.id, credit?.files.length, credit?.analysis?.id, credit?.analysis?.status, credit?.error, credit?.busy]);
  useEffect(() => { creditDragDepth.current = 0; setCreditDragging(false); }, [room?.id]);
  useEffect(() => {
    if (!creditFocus || creditFocus.roomId !== room?.id) return;
    setTab('customer');
    setCreditExpanded(true);
    const timer = window.setTimeout(() => {
      if (creditRef.current?.getClientRects().length) {
        creditRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setCreditFlash(true);
      }
    }, 50);
    const clear = window.setTimeout(() => setCreditFlash(false), 1500);
    return () => { window.clearTimeout(timer); window.clearTimeout(clear); };
  }, [creditFocus, room?.id]);
  // gfinFocus → เปิดแท็บ GFIN (เหมือน creditFocus แต่ไม่ต้อง scroll — เนื้อหาแท็บเป็นสกอร์ลของตัวเอง)
  useEffect(() => { if (gfinFocus && gfinFocus.roomId === room?.id) setTab('gfin'); }, [gfinFocus, room?.id]);
  const gfinApp = gfin?.current ?? null;
  const [seenTick, setSeenTick] = useState(0);
  const gfinDot = needsAttention(gfinApp, gfinApp ? readSeen(gfinApp.id) : null);
  // เปิดแท็บ GFIN → ทำเครื่องหมายว่าเห็นแล้ว (spec §6.1) — seenTick บังคับ re-render เพื่ออ่าน localStorage ใหม่หลัง markSeen
  useEffect(() => { if (tab === 'gfin' && gfinApp) { markSeen(gfinApp); setSeenTick(t => t + 1); } }, [tab, gfinApp?.id, gfinApp?.lastPartnerEventAt]);
  const acceptsDrop = (event: React.DragEvent) => {
    const types = Array.from(event.dataTransfer.types);
    if (tab === 'gfin') return !!gfin && types.some(type => type === 'Files' || type === GFIN_MESSAGE_MIME);
    return !!credit && types.some(type => type === 'Files' || type === CREDIT_MESSAGE_MIME);
  };
  /* หลังรวม: ผลวิเคราะห์ที่ย้ายไปอยู่กับคนที่รอด (mockup บอร์ด 5) — state ของห้องที่กดรวม ไม่ persist
     มาจากสองทาง: ปุ่มรวม (absorb-into) และ "ผูกกับลูกค้าเดิม" (PATCH rooms/:id/customer คืน `absorbed`)
     `roomId` จับตอนกด ไม่ใช่ตอนสำเร็จ: สลับห้องระหว่างรอ response ต้องไม่ไปโผล่ในห้องอื่น */
  const [mergeNotice, setMergeNotice] = useState<{ roomId: string; count: number; targetId: string; fromThisRoom: boolean } | null>(null);
  useEffect(() => { if (mergeNotice?.roomId === room?.id) setCreditExpanded(true); }, [mergeNotice, room?.id]);
  // เปิดห้องใหม่ → กลับแท็บ 1 เสมอ (สิ่งที่ต้องรู้ก่อนพิมพ์คำแรก) · ข้อความหลังรวมของห้องก่อนหน้าหายไปด้วย
  const [tabRoom, setTabRoom] = useState<string | null>(null);
  if (room?.id && tabRoom !== room.id) {
    setTabRoom(room.id);
    setTab('customer');
    setMergeNotice(null);
  }
  const [linkOpen, setLinkOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  /* สิทธิ์สร้างลูกค้า = `@Roles` ของ POST /customers (OWNER/BRANCH_MANAGER/SALES) — ปิดปุ่มก่อน ไม่ให้กรอกจนจบแล้ว 403
     ส่วน "ผูกห้อง" (PATCH rooms/:id/customer) กว้างกว่า (มี FINANCE_MANAGER) จึงไม่แตะปุ่มค้นหาลูกค้าเดิม */
  const { user } = useAuth();
  const canCreate = canCreateCustomer(user?.role);
  /* ผูกลูกค้าที่เพิ่งสร้างเข้าห้อง — แยกจากขั้นสร้าง เพราะสร้างสำเร็จแล้วผูกพลาดต้อง "ลองผูกอีกครั้ง" ไม่ใช่กดบันทึกซ้ำ (จะ 409) */
  const linkCreated = useLinkRoomCustomer(room?.id ?? '', {
    onSuccess: () => toast.success('เพิ่มลูกค้าและผูกกับแชทแล้ว'),
    onError: (_err, customerId) => toast.error('สร้างลูกค้าแล้ว แต่ผูกกับแชทไม่สำเร็จ', {
      description: 'ลูกค้าอยู่ในระบบแล้ว ผูกอีกครั้งได้เลย',
      action: { label: 'ลองผูกอีกครั้ง', onClick: () => linkCreated.mutate(customerId) },
    }),
  });
  const [apptOpen, setApptOpen] = useState(false);

  /* ห้องมีเจ้าของ 3 แบบ: ไม่มีเลย (ห้องเว็บก่อนข้อความแรก / เจ้าของถูกลบ) · ผู้สนใจอัตโนมัติจากแชท (placeholder — ธงจาก API เท่านั้น) · ลูกค้าจริง
     "linked" ของแผงเดิม = ลูกค้าจริงเท่านั้น (สัญญา/ประกัน/ช่องทางอื่นมีความหมายกับคนที่มีเบอร์แล้ว) */
  const placeholder = !!customerId && !!room?.customer?.chatPlaceholder;
  const linked = !!customerId && !placeholder;
  const canFill = canFillProspectContact(user?.role);
  const [fillOpen, setFillOpen] = useState(false);
  const absorb = useAbsorbCustomer(room?.id ?? '', {
    onSuccess: () => toast.success('รวมเป็นคนเดียวกันแล้ว — แชทและผลเช็คเครดิตย้ายไปแล้ว'),
    onError: (err, args) => {
      /* R-1: ต้นทางเป็น "ผู้สนใจอีกคน" (ไม่ใช่เจ้าของห้องนี้) — ด่าน SALES ของ API ตรวจห้องของคนนั้น
         ข้อความ API ("ผู้สนใจคนนี้") อ่านเป็นห้องที่เปิดอยู่ได้ ⇒ บอกให้ชัดว่าติดที่ใคร และใครกดแทนได้ */
      const status = (err as { response?: { status?: number } } | null)?.response?.status;
      const otherHeld = status === 403 && user?.role === 'SALES' && args.placeholderId !== customerId;
      toast.error(otherHeld ? ABSORB_OTHER_HELD_MSG : getErrorMessage(err));
    },
  });
  const dismiss = useDismissSamePerson(room?.id ?? '', {
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const queryClient = useQueryClient();
  const work = useChatWorkSettings();
  const followUpEnabled = !!work.settings.data?.flags.chat_follow_up_enabled;
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffTask, setHandoffTask] = useState<string | null>(null);
  const workIdentity = `${work.key.join(':')}:${room?.id}`;
  useEffect(() => { setHandoffTask(null); setHandoffOpen(false); }, [workIdentity]);
  const [editingAppt, setEditingAppt] = useState<Todo | null>(null);
  const newAppointment = () => { setEditingAppt(null); setApptOpen(true); };
  // นัดของห้อง — คีย์ขึ้นต้น 'todos' เพื่อให้ TodoForm invalidate แล้วรายการนี้รีเฟรชด้วย
  const todosQuery = useInfiniteQuery({
    queryKey: ['todos', ...work.key, 'room', room?.id, 'pages'],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get('/todos', { params: { ...work.scope, roomId: room!.id, limit: 20, page: pageParam } });
      const rows: Todo[] = Array.isArray(data) ? data : data?.data ?? [];
      return { rows, total: typeof data?.total === 'number' ? data.total : rows.length };
    },
    getNextPageParam: (last, pages) => pages.reduce((n, page) => n + page.rows.length, 0) < last.total && last.rows.length ? pages.length + 1 : undefined,
    enabled: !!room?.id,
  });
  const roomTodos = todosQuery.data?.pages.flatMap(page => page.rows) ?? [];
  const staffQuery = useQuery<AssigneeRef[]>({
    queryKey: [...work.key, 'eligible', room?.id],
    queryFn: () => api.get(`/staff-chat/rooms/${room!.id}/eligible-staff`).then((r) => r.data),
    enabled: apptOpen && !followUpEnabled,
  });
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
      <aside className="inbox-dossier flex h-full w-80 shrink-0 flex-col items-center justify-center border-l border-border p-6 text-center" aria-label="ข้อมูลลูกค้า">
        <MessagesSquare className="mb-3 size-7 text-muted-foreground/30" />
        <p className="text-xs font-semibold text-muted-foreground">ข้อมูลลูกค้า</p>
        <p className="mt-1 max-w-[180px] text-[11px] leading-relaxed text-muted-foreground">เลือกแชทเพื่อดูข้อมูลลูกค้า สัญญา และประกัน</p>
      </aside>
    );
  }

  const name = room.customer?.name ?? room.displayName ?? 'ไม่ระบุชื่อ';
  const metaLine = [channelLabel[room.channel] ?? room.channel, room.customer?.phone].filter(Boolean).join(' · ');

  const tabs: { key: TabKey; label: string; count?: number; dot?: boolean }[] = [
    { key: 'customer', label: 'ข้อมูลลูกค้า' },
    { key: 'money', label: 'สัญญา/ชำระ', count: linked ? contracts.length || undefined : undefined },
    { key: 'device', label: 'ประกัน', count: linked ? devicesCount || undefined : undefined },
    { key: 'gfin', label: 'GFIN', dot: gfinDot },
  ];

  /* เปิดฟอร์มสร้างลูกค้าเป็น popup ทับห้อง (ของเดิม navigate ไป /customers?new=1 แล้วเด้งกลับ /inbox = หลุดห้อง)
     เติมชื่อจากห้องให้ก่อน · ห้อง Facebook เติม "ชื่อ Facebook" ด้วย เพราะเป็นชื่อบัญชีจริงของลูกค้า */
  const createInitialValues = {
    ...splitDisplayName(room.displayName),
    ...(room.channel === 'FACEBOOK' && room.displayName ? { facebookName: room.displayName } : {}),
  };

  /* รวมจากห้องนี้ (คำใบ้ทั้งสองแบบ + "ใช้คนเดิม" ในฟอร์มเติมเบอร์) — จับห้อง/ทิศทางไว้ตอนกด
     ต้นทางเป็นเจ้าของห้องนี้ = ผลวิเคราะห์ย้ายออกจากห้องนี้ · ไม่งั้น = ย้ายเข้ามาจากผู้สนใจอีกคน */
  const noteMovedCredit = (roomId: string, targetId: string, count: number, fromThisRoom: boolean) => {
    if (count > 0) setMergeNotice({ roomId, count, targetId, fromThisRoom });
  };
  const mergeFromRoom = (args: AbsorbArgs) => {
    const roomId = room.id;
    const fromThisRoom = args.placeholderId === customerId;
    absorb.mutate(args, {
      onSuccess: (result) => noteMovedCredit(roomId, result.targetId, result.movedCreditChecks, fromThisRoom),
    });
  };
  /* M-W6: ผูกกับลูกค้าเดิม = รวมผู้สนใจของห้องนี้เข้าคนที่เลือก ⇒ ผลวิเคราะห์ "ย้ายมาจากห้องนี้" เสมอ
     ห้องที่ยิงจริงมากับผลลัพธ์ (hook จับตอน mutate) · ห้องไม่มีเจ้าของได้ absorbed = null */
  const onRoomLinked = ({ roomId, absorbed }: LinkRoomResult) => {
    if (absorbed) noteMovedCredit(roomId, absorbed.targetId, absorbed.movedCreditChecks, true);
  };
  const samePersonHints = (currentIsProspect: boolean) => (
    <SamePersonHints
      hints={room.possibleSamePerson ?? []}
      customerId={customerId!}
      currentIsProspect={currentIsProspect}
      onMerge={mergeFromRoom}
      onDismiss={(id) => dismiss.mutate(id)}
      busy={absorb.isPending || dismiss.isPending}
    />
  );

  return (
    <aside className="inbox-dossier relative flex h-full w-80 shrink-0 flex-col border-l border-border bg-card" aria-label="ข้อมูลลูกค้า"
      onDragEnter={event => { if (!acceptsDrop(event)) return; event.preventDefault(); creditDragDepth.current++; setCreditDragging(true); }}
      onDragOver={event => { if (!acceptsDrop(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = (tab === 'gfin' ? gfin?.busy : credit?.busy) ? 'none' : 'copy'; }}
      onDragLeave={event => { if (!acceptsDrop(event)) return; event.preventDefault(); if (--creditDragDepth.current <= 0) { creditDragDepth.current = 0; setCreditDragging(false); } }}
      onDrop={event => {
        if (!acceptsDrop(event)) return;
        event.preventDefault(); event.stopPropagation(); creditDragDepth.current = 0; setCreditDragging(false);
        if (tab === 'gfin') {
          if (gfin?.busy) return;
          const gfinMessageId = event.dataTransfer.getData(GFIN_MESSAGE_MIME);
          if (gfinMessageId) onPickSlot?.(gfinMessageId);
          else window.dispatchEvent(new CustomEvent('gfin-drop-files', { detail: Array.from(event.dataTransfer.files) }));
          return;
        }
        if (credit?.busy) return;
        setTab('customer');
        setCreditExpanded(true);
        const messageId = event.dataTransfer.getData(CREDIT_MESSAGE_MIME);
        if (messageId) { if (!credit?.files.some(file => file.sourceMessageId === messageId)) credit?.toggleMessage(messageId); }
        else credit?.upload(Array.from(event.dataTransfer.files));
      }}>
      {creditDragging && <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-primary bg-primary/10"><div className="rounded-xl border border-primary bg-card px-4 py-5 text-center text-primary shadow-sm"><p className="font-semibold leading-snug">{tab === 'gfin' ? 'วางที่นี่ = ใส่ในใบยื่น GFIN' : 'วางที่นี่ = ให้ AI ตรวจเครดิต'}</p><p className="mt-1 text-xs leading-snug">ลูกค้าไม่เห็น</p>{(tab === 'gfin' ? gfin?.busy : credit?.busy) && <p className="mt-2 text-xs">กำลังทำงาน กรุณารอก่อนแนบไฟล์</p>}</div></div>}
      <header className="inbox-dossier-header flex shrink-0 items-center justify-between gap-2 px-5 py-4">
        <div className="flex min-w-0 items-center gap-2">{onClose && <Button variant="ghost" size="icon" aria-label="ปิดข้อมูลลูกค้า" onClick={onClose}><ArrowLeft className="size-5" /></Button>}<h2 className="text-base font-semibold leading-snug">ข้อมูลและงาน</h2></div>
        <div className="flex shrink-0"><Button variant="ghost" size="icon" aria-label="เปิดโปรไฟล์ลูกค้าเต็มหน้า" disabled={!customerId} onClick={() => customerId && navigate(`/customers/${customerId}`)}><ExternalLink className="size-4" /></Button></div>
      </header>
      {/* แท็บเม็ดยา */}
      <div role="tablist" data-gfin-seen-tick={seenTick} className="inbox-dossier-tabs flex shrink-0 border-b border-border px-2">
        {tabs.map((t) => {
          const on = tab === t.key;
          return (
            <button data-ui-control="button"
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={cn(
                'inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap border-b-2 px-1 text-xs font-semibold transition-colors',
                on
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:bg-muted',
              )}
            >
              <span className="min-w-0">{t.label}</span>
              {t.dot && <span aria-label="มีความเคลื่อนไหวจาก GFIN" className="size-2 rounded-full bg-warning" />}
              {t.count != null && <span className={cn('font-semibold', on ? 'opacity-90' : 'text-muted-foreground')}>{t.count}</span>}
            </button>
          );
        })}
      </div>

      {/* เนื้อหาแท็บ */}
      <div className="inbox-dossier-content flex-1 min-h-0 overflow-y-auto bg-card">
        {tab === 'customer' && (
          <div className="flex flex-col gap-2.5 p-2.5">
            <section className="inbox-dossier-group inbox-customer-identity" aria-label="ข้อมูลลูกค้า">
              <div className="mb-3 flex min-w-0 items-center gap-3">
                <Avatar className="size-11 shrink-0"><AvatarImage src={room.pictureUrl ?? undefined} alt="" /><AvatarFallback className="bg-primary/5 text-primary">{name[0]}</AvatarFallback></Avatar>
                <div className="min-w-0"><p className="truncate text-sm font-semibold">{name}</p><p className="mt-1 text-xs leading-snug text-muted-foreground">{metaLine}</p></div>
              </div>
              {linked ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-muted-foreground">ผูกข้อมูลลูกค้าแล้ว</span><Button variant="ghost" size="sm" onClick={() => navigate(`/customers/${customerId}`)}>ดูโปรไฟล์</Button></div>
                  {/* สเปค 3.6 — ลูกค้าจริงก็เห็นคำใบ้ (ดูดผู้สนใจอีกคนเข้าคนนี้) */}
                  {samePersonHints(false)}
                </>
              ) : placeholder ? (
                <ProspectCard
                  room={room}
                  canFill={canFill}
                  onFill={() => setFillOpen(true)}
                  onLink={() => setLinkOpen(true)}
                  hints={samePersonHints(true)}
                />
              ) : (
                <div>
                  <p className="text-xs text-muted-foreground">ยังไม่ผูกลูกค้า</p>
                  <div className="inbox-dossier-link-actions mt-2">
                    <Button variant="outline" size="sm" aria-label="ค้นหาลูกค้าเดิม" onClick={() => setLinkOpen(true)}><Search className="size-4" aria-hidden="true" />ผูกลูกค้า</Button>
                    <Button variant="ghost" size="sm" aria-label="สร้างลูกค้าใหม่" disabled={!canCreate} title={canCreate ? undefined : 'สร้างลูกค้าได้เฉพาะเจ้าของ ผู้จัดการสาขา และฝ่ายขาย'} onClick={() => setCreateOpen(true)}><UserPlus className="size-4" aria-hidden="true" />สร้างใหม่</Button>
                  </div>
                </div>
              )}
            </section>

            <div id="room-appointments" className="scroll-mt-2">
              <RoomFollowUps key={workIdentity}
                todos={roomTodos} loading={todosQuery.isLoading} error={todosQuery.isError}
                onRetry={() => { void (todosQuery.isFetchNextPageError ? todosQuery.fetchNextPage() : todosQuery.refetch()); }}
                hasMore={todosQuery.hasNextPage} loadingMore={todosQuery.isFetchingNextPage}
                onLoadMore={() => { void todosQuery.fetchNextPage(); }}
                onNew={newAppointment} onEdit={todo => { setEditingAppt(todo); setApptOpen(true); }} />
            </div>
            <div id="room-store-appointment"><CustomerAppointments customerId={customerId} roomId={room.id} /></div>

            <div ref={creditRef} className="inbox-dossier-credit scroll-mt-2">
              <DossierDisclosure title="ตรวจเครดิต" open={creditExpanded} onOpenChange={setCreditExpanded}
                summary={credit?.loading ? 'กำลังโหลดเอกสาร…' : credit?.busy ? 'กำลังดำเนินการ…' : credit?.error || credit?.analysis?.status === 'FAILED' ? 'มีข้อผิดพลาด กรุณาตรวจสอบ' : credit?.files.length ? `${credit.files.length} ไฟล์${credit.analysis?.status === 'COMPLETED' ? ' · มีผลวิเคราะห์' : ' · พร้อมตรวจ'}` : 'ยังไม่มีเอกสาร'}
                className={creditFlash ? 'ring-2 ring-primary/40' : undefined}>
                {placeholder && <Hint>ผลจะติดอยู่กับผู้สนใจคนนี้ และตามไปเมื่อรวมกับลูกค้าเดิม</Hint>}
                {mergeNotice && mergeNotice.roomId === room.id && (
                  <p className="m-0 mb-2 text-xs leading-snug text-muted-foreground">
                    ผลวิเคราะห์ {mergeNotice.count} รายการ {mergeNotice.fromThisRoom ? 'ย้ายมาจากห้องนี้ตอนรวม' : 'ย้ายมาจากผู้สนใจที่รวมเข้ามา'} — ดูได้ใน<Link to={`/customers/${mergeNotice.targetId}?tab=credit`} className="font-semibold text-primary hover:underline">โปรไฟล์ลูกค้า › เครดิต</Link>
                  </p>
                )}
                <div className="mb-3 space-y-3">
                  <div className="inbox-credit-dropzone"><p>ลากไฟล์จากแชทหรือเลือกไฟล์</p><p>PDF / รูปภาพ · ไม่เกิน 10 MB/ไฟล์ · สูงสุด 10 ไฟล์</p></div>
                  <CloudCreditPicker localPicker={<CreditFilePicker credit={credit} />} roomId={room.id} disabled={credit?.busy || credit?.loading} />
                </div>
                <RoomCreditCard key={room.id} credit={credit} customerId={customerId} hideEmptyState />
              </DossierDisclosure>
              {!creditExpanded && <Button variant="outline" className="mb-4 w-full" disabled={!credit || credit.loading} onClick={() => setCreditExpanded(true)}><Paperclip className="size-4" aria-hidden="true" />แนบเอกสารตรวจเครดิต</Button>}
            </div>

            <ChatSalesContext roomId={room.id} />

            <ChatServiceRequestSection key={`service:${workIdentity}`} roomId={room.id} compact />

            <DossierDisclosure key={`additional:${workIdentity}`} title="ข้อมูลเพิ่มเติม" summary="โฆษณา · ช่องทางแชท · ประวัติ">
            <AdGroup room={room} />

            {!!work.settings.data?.flags.chat_mentions_enabled && <Group label="งานที่ฝากทีม">
              <Button variant="outline" size="sm" onClick={() => setHandoffOpen(true)}>ส่งงานให้ทีม</Button>
              {roomTodos.filter(t => t.workKind === 'CHAT_HANDOFF').map(t => <button key={t.id} className="mt-2 block w-full rounded-md border p-3 text-left text-sm leading-snug hover:bg-accent" onClick={() => setHandoffTask(t.id)}>{t.title}<span className="mt-1 block text-xs text-muted-foreground">ผู้รับงาน: {t.assignee?.nickname || t.assignee?.name || 'ไม่ระบุ'}</span></button>)}
            </Group>}

            <Group label="สินค้าที่กำลังคุย">
              <ProductContextCard roomId={room.id} empty={<Hint>ยังไม่พบรุ่นในแชทนี้ — เลือกส่งได้จากปุ่มสินค้าที่แถบพิมพ์</Hint>} />
            </Group>

            <ChannelsGroup room={room} linked={linked} placeholder={placeholder} onSelectRoom={onSelectRoom} onLink={() => setLinkOpen(true)} />
            <Group label="ประวัติห้อง">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs leading-snug">
                <dt className="text-muted-foreground">เริ่มคุยเมื่อ</dt><dd>{fmtDateTime(room.createdAt) || '—'}</dd>
                <dt className="text-muted-foreground">ข้อความ</dt><dd>{room.totalMessages ?? 0}{room.lastMessageAt ? ` · ล่าสุด ${formatChatTimestamp(room.lastMessageAt)}` : ''}</dd>
              </dl>
            </Group>
            </DossierDisclosure>
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
            ) : placeholder ? (
              /* ผู้สนใจมีเจ้าของแล้ว — ทางไปต่อจริงคือเติมเบอร์ หรือผูกกับลูกค้าเดิม (ไม่ใช่ "ผูกลูกค้า") */
              <>
                <Group label="สัญญา"><Hint>เพิ่มเบอร์หรือผูกลูกค้าเดิมเพื่อดูสัญญาและค่างวด</Hint></Group>
                <Group label="ประวัติการชำระ"><Hint>เพิ่มเบอร์หรือผูกลูกค้าเดิมเพื่อดูสัญญาและค่างวด</Hint></Group>
                <Group label="บันทึกการโทร"><Hint>ยังไม่มี — ผู้สนใจคนนี้ยังไม่มีเบอร์</Hint></Group>
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
                {contracts.length === 0 && <ImeiLookup owner="customer" />}
              </>
            ) : (
              <ImeiLookup owner={placeholder ? 'prospect' : 'none'} />
            )}
          </div>
        )}

        {tab === 'gfin' && <GfinTab room={room} customerId={customerId} gfin={gfin} onPickSlotForMessage={onPickSlot} />}
      </div>

      <LinkCustomerDialog open={linkOpen} onOpenChange={setLinkOpen} roomId={room.id} mergesProspect={placeholder} onLinked={onRoomLinked} />
      <CustomerCreateDialog
        key={room.id}
        linkedToChat
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialValues={createInitialValues}
        submitLabel="บันทึกและผูกกับแชท"
        onCreated={(c) => linkCreated.mutate(c.id)}
        onUseExisting={(c) => linkCreated.mutate(c.id)}
        context={
          <div className="flex items-center gap-2.5 border-b border-primary/25 bg-primary/8 px-6 py-2.5 text-xs leading-snug">
            <span className="relative size-7 shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-border">
              <Avatar className="size-full"><AvatarImage src={room.pictureUrl ?? undefined} alt="" /><AvatarFallback>{name[0]}</AvatarFallback></Avatar>
              <span className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card', channelDot[room.channel] ?? 'bg-muted-foreground')} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="text-muted-foreground">บันทึกแล้วจะผูกกับห้องแชท </span>
              <span className="font-semibold">{name}</span>
              <span className="text-muted-foreground"> · {channelLabel[room.channel] ?? room.channel}</span>
            </span>
            <span className="shrink-0 font-medium text-primary">ยังอยู่ในห้องนี้หลังบันทึก</span>
          </div>
        }
      />
      {placeholder && customerId && (
        <CustomerCreateDialog
          key={`fill-${room.id}`}
          mode="fill"
          fillCustomerId={customerId}
          open={fillOpen}
          onOpenChange={setFillOpen}
          initialValues={createInitialValues}
          submitLabel="บันทึก"
          onCreated={() => undefined}
          onFilled={() => {
            queryClient.invalidateQueries({ queryKey: ['chat-room', room.id] });
            queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
            queryClient.invalidateQueries({ queryKey: ['customers'] });
          }}
          onUseExisting={(c) => mergeFromRoom({ placeholderId: customerId, targetId: c.id })}
          context={
            <div className="flex items-center gap-2.5 border-b border-primary/25 bg-primary/8 px-6 py-2.5 text-xs leading-snug">
              <span className="relative size-7 shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-border">
                <Avatar className="size-full"><AvatarImage src={room.pictureUrl ?? undefined} alt="" /><AvatarFallback>{name[0]}</AvatarFallback></Avatar>
                <span className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card', channelDot[room.channel] ?? 'bg-muted-foreground')} />
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="text-muted-foreground">แก้ข้อมูลของ </span>
                <span className="font-semibold">{name}</span>
                <span className="text-muted-foreground"> · {channelLabel[room.channel] ?? room.channel} · ไม่สร้างคนใหม่</span>
              </span>
              <span className="shrink-0 font-medium text-primary">ยังอยู่ในห้องนี้หลังบันทึก</span>
            </div>
          }
        />
      )}
      {/* ตั้งนัด = ฟอร์ม Todo ตัวเดิม ผูกห้อง + ชื่อล่วงหน้า · บันทึกแล้ว invalidate ['todos'] → รายการนัดข้างบนรีเฟรช */}
      <ChatHandoffDialog key={`handoff:${work.key.join(':')}:${room.id}`} roomId={room.id} open={handoffOpen} onOpenChange={setHandoffOpen} />
      <Dialog open={!!handoffTask} onOpenChange={o => !o && setHandoffTask(null)}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogTitle>งานที่ฝากทีม</DialogTitle><DialogDescription>ผู้รับงานและผลการดำเนินงานในห้องนี้</DialogDescription>{handoffTask && <ChatHandoffCard key={`${work.key.join(':')}:${handoffTask}`} taskId={handoffTask} />}</DialogContent></Dialog>
      {followUpEnabled && (!editingAppt || editingAppt.workKind === 'CHAT_FOLLOW_UP') ? <ChatFollowUpDialog key={`${work.company}:${room.id}`} roomId={room.id} open={apptOpen} onOpenChange={setApptOpen} editing={editingAppt ? { ...editingAppt, revision: editingAppt.revision ?? 0 } : undefined} /> : <TodoForm
        open={apptOpen}
        onOpenChange={setApptOpen}
        editing={editingAppt}
        staffUsers={Array.isArray(staffQuery.data) ? staffQuery.data : []}
        defaults={{ title: `นัด ${name}`, roomId: room.id, priority: 'MEDIUM', status: 'TODO' }}
      />}
    </aside>
  );
}
