import { useState } from 'react';
import { useLiffInit } from '@/hooks/useLiffInit';
import { liffApi } from '@/lib/api';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  FileText,
  History,
  Unlink2,
  User,
  Phone,
  MessageCircle,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LIFF_ERRORS } from '@/constants/liff-errors';

import type { LiffProfileResponse as ProfileData } from '@installment/shared';

export default function LiffProfile() {
  const { lineId, profile, loading, error } = useLiffInit();
  const [unlinked, setUnlinked] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    message: string;
    action: () => void;
  }>({ open: false, message: '', action: () => {} });

  const { data, isLoading: dataLoading, error: dataError } = useQuery<ProfileData>({
    queryKey: ['liff-profile', lineId],
    queryFn: async () => {
      const { data } = await liffApi
        .get(`/line-oa/liff/profile?lineId=${encodeURIComponent(lineId!)}`)
        .catch((err) => {
          if (err.response?.status === 404) throw new Error(LIFF_ERRORS.NOT_REGISTERED);
          throw new Error(LIFF_ERRORS.LOAD_FAILED);
        });
      return data;
    },
    enabled: !!lineId,
  });

  const unlinkMutation = useMutation({
    mutationFn: async () => {
      const { data: result } = await liffApi.post('/line-oa/liff/unlink', { lineId });
      return result;
    },
    onSuccess: () => {
      setUnlinked(true);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    },
  });

  function handleUnlink() {
    setConfirmDialog({
      open: true,
      message:
        'ต้องการยกเลิกผูก LINE จริงหรือไม่?\n\nหลังจากยกเลิก จะไม่สามารถใช้งานผ่าน LINE ได้อีก ต้องลงทะเบียนใหม่',
      action: () => unlinkMutation.mutate(),
    });
  }

  const customerInitial = (data?.name ?? '').charAt(0) || '?';

  // ─── Loading ──────────────────────────────────────────
  if (loading || dataLoading) {
    return (
      <Shell>
        <div className="px-5 pt-6 space-y-4">
          <Skeleton className="h-24 w-full rounded-[22px]" />
          <Skeleton className="h-40 w-full rounded-[22px]" />
          <Skeleton className="h-32 w-full rounded-[22px]" />
        </div>
      </Shell>
    );
  }

  // ─── Error ────────────────────────────────────────────
  if (error || dataError) {
    return (
      <Shell>
        <TopBar title="โปรไฟล์ของฉัน" initial="?" />
        <section className="relative z-[1] px-5 pt-10 pb-8 flex flex-col items-center text-center">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-destructive/10 border border-destructive/30 mb-5">
            <span className="text-destructive text-4xl font-light leading-none">!</span>
          </div>
          <h2 className="text-[18px] font-semibold text-foreground tracking-tight leading-snug">
            ไม่สามารถดำเนินการได้
          </h2>
          <p className="mt-2 text-[13px] text-muted-foreground leading-snug max-w-[280px]">
            {error || (dataError as Error)?.message}
          </p>
        </section>
      </Shell>
    );
  }

  // ─── Unlinked state ───────────────────────────────────
  if (unlinked) {
    return (
      <Shell>
        <section className="relative z-[1] min-h-[80vh] flex flex-col items-center justify-center px-5 text-center">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-muted border border-border mb-6">
            <Unlink2 className="size-9 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <h2 className="text-[18px] font-semibold text-foreground tracking-tight leading-snug">
            ยกเลิกผูก LINE แล้ว
          </h2>
          <p className="mt-2 text-[13px] text-muted-foreground leading-snug max-w-[280px]">
            บัญชี LINE ของคุณถูกยกเลิกการเชื่อมต่อกับระบบแล้ว
          </p>
          <Button variant="primary" size="lg" className="mt-8 w-full max-w-xs" asChild>
            <a href={`/liff/register${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
              ลงทะเบียนใหม่
            </a>
          </Button>
        </section>
      </Shell>
    );
  }

  if (!data) return null;

  const points = data.totalPoints ?? 0;
  const lineDisplayName = profile?.displayName || data.lineDisplayName || '-';

  // ─── Main ─────────────────────────────────────────────
  return (
    <Shell>
      <TopBar title="โปรไฟล์ของฉัน" initial={customerInitial} />

      {/* Identity hero */}
      <section className="relative z-[1] px-5 pt-7">
        <div
          className="absolute pointer-events-none animate-[float_3.5s_ease-in-out_infinite]"
          style={{
            top: '0px',
            left: '-40px',
            width: '220px',
            height: '220px',
            borderRadius: '50%',
            filter: 'blur(60px)',
            opacity: 0.55,
            background: 'radial-gradient(circle, rgb(16 185 129), transparent 70%)',
          }}
        />
        <div
          className="absolute pointer-events-none animate-[float_3.5s_ease-in-out_infinite_1.2s]"
          style={{
            top: '50px',
            right: '-30px',
            width: '180px',
            height: '180px',
            borderRadius: '50%',
            filter: 'blur(60px)',
            opacity: 0.45,
            background: 'radial-gradient(circle, rgb(251 191 36), transparent 70%)',
          }}
        />

        <div className="relative flex items-center gap-4">
          <div
            className="relative grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-white text-[22px] font-semibold shadow-lg shadow-emerald-500/30"
            style={{
              background:
                'linear-gradient(135deg, rgb(16 185 129) 0%, rgb(5 150 105) 50%, rgb(13 148 136) 100%)',
            }}
          >
            {customerInitial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-emerald-700 leading-snug">
              ลูกค้า Best Choice
            </div>
            <div className="mt-1 text-[19px] font-semibold tracking-tight text-foreground leading-snug">
              คุณ{data.name}
            </div>
            <div className="mt-0.5 text-[12px] text-muted-foreground leading-snug">
              {data.contractCount} สัญญา · เริ่มใช้งาน LINE แล้ว
            </div>
          </div>
        </div>
      </section>

      {/* Points hero */}
      <section className="relative z-[1] mt-7 px-5">
        <div
          className="relative overflow-hidden rounded-[22px] p-5 shadow-lg shadow-amber-500/15"
          style={{
            background:
              'linear-gradient(135deg, rgb(254 243 199) 0%, rgb(253 230 138) 55%, rgb(251 191 36) 100%)',
          }}
        >
          <div
            className="absolute -top-8 -right-8 size-28 rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgb(255 255 255 / 0.55), transparent 70%)',
            }}
          />
          <div
            className="absolute -bottom-10 -left-10 size-32 rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgb(180 83 9 / 0.25), transparent 70%)',
            }}
          />

          <div className="relative flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="size-3 text-amber-900" strokeWidth={2} />
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-amber-900 leading-snug">
                  แต้มสะสม
                </span>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span
                  className="font-mono font-light tabular-nums tracking-[-0.035em] text-amber-950"
                  style={{ fontSize: '54px', lineHeight: '0.95' }}
                >
                  {points.toLocaleString()}
                </span>
                <span className="text-[11px] font-medium text-amber-900/70 leading-snug">แต้ม</span>
              </div>
            </div>
            <div
              className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-950/10 backdrop-blur-sm"
            >
              <Wallet className="size-[20px] text-amber-900" strokeWidth={1.75} />
            </div>
          </div>

          <div className="relative mt-4 pt-4 border-t border-amber-900/15 space-y-1.5">
            <div className="flex items-center gap-2 text-[11.5px] text-amber-900/85 leading-snug">
              <span className="h-1 w-1 rounded-full bg-amber-900/60 shrink-0" />
              <span>ชำระตรงเวลา รับ 1 แต้ม ต่อ 100 บาท</span>
            </div>
            <div className="flex items-center gap-2 text-[11.5px] text-amber-900/85 leading-snug">
              <span className="h-1 w-1 rounded-full bg-amber-900/60 shrink-0" />
              <span>ใช้แลกส่วนลดดาวน์เครื่องใหม่ได้ทันที</span>
            </div>
          </div>
        </div>
      </section>

      {/* Personal info section */}
      <div className="relative z-[1] mt-8 flex items-center gap-3 px-5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground leading-snug">
          ข้อมูลส่วนตัว
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
      </div>

      <section className="relative z-[1] mt-4 px-5">
        <div className="rounded-[22px] border border-border/50 bg-card p-1 shadow-sm">
          <InfoRow
            icon={<User className="size-[15px] text-indigo-700" strokeWidth={1.75} />}
            label="ชื่อ"
            value={data.name}
          />
          <InfoRow
            icon={<Phone className="size-[15px] text-emerald-700" strokeWidth={1.75} />}
            label="เบอร์โทร"
            value={data.phone}
            mono
          />
          <InfoRow
            icon={<MessageCircle className="size-[15px] text-[#06C755]" strokeWidth={1.75} />}
            label="LINE"
            value={lineDisplayName}
            last
          />
        </div>
      </section>

      {/* Quick actions */}
      <div className="relative z-[1] mt-8 flex items-center gap-3 px-5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground leading-snug">
          เมนูลัด
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
      </div>

      <section className="relative z-[1] mt-4 px-5 space-y-2.5">
        <ActionCard
          href={`/liff/contract${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}
          icon={<FileText className="size-[18px]" strokeWidth={1.5} />}
          iconBg="linear-gradient(135deg, rgb(16 185 129) 0%, rgb(5 150 105) 55%, rgb(13 148 136) 100%)"
          iconShadow="shadow-emerald-500/25"
          label="สัญญาของฉัน"
          sub={`${data.contractCount} สัญญา`}
        />
        <ActionCard
          href={`/liff/history${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}
          icon={<History className="size-[18px]" strokeWidth={1.5} />}
          iconBg="linear-gradient(135deg, rgb(99 102 241) 0%, rgb(59 130 246) 60%, rgb(6 182 212) 100%)"
          iconShadow="shadow-indigo-500/25"
          label="ประวัติชำระเงิน"
          sub="ทุกงวดที่จ่ายแล้ว"
        />
      </section>

      {/* Unlink */}
      <section className="relative z-[1] mt-10 px-5">
        <button
          type="button"
          onClick={handleUnlink}
          disabled={unlinkMutation.isPending}
          className="w-full flex items-center justify-center gap-2 rounded-[18px] border border-border/50 bg-card px-4 py-3.5 text-[13px] font-medium text-destructive active:scale-[0.99] transition-transform leading-snug disabled:opacity-60"
        >
          <Unlink2 className="size-[15px]" strokeWidth={1.75} />
          {unlinkMutation.isPending ? 'กำลังดำเนินการ...' : 'ยกเลิกผูก LINE'}
        </button>
        <p className="mt-4 text-center text-[10px] text-muted-foreground/70 tracking-[0.15em] uppercase leading-snug">
          Best Choice · ระบบผ่อนชำระ
        </p>
      </section>

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        title="ยืนยันยกเลิก"
        description={confirmDialog.message}
        variant="destructive"
        onConfirm={confirmDialog.action}
      />
    </Shell>
  );
}

// ─── UI primitives ─────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden" style={{ backgroundColor: '#fafaf7' }}>
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background:
            'radial-gradient(600px 400px at 10% -5%, rgb(16 185 129 / 0.09), transparent 60%),' +
            'radial-gradient(500px 380px at 100% 20%, rgb(251 191 36 / 0.08), transparent 65%),' +
            'radial-gradient(400px 320px at 50% 100%, rgb(99 102 241 / 0.05), transparent 60%)',
        }}
      />
      <div className="relative mx-auto max-w-[430px] pb-16">{children}</div>
    </div>
  );
}

function TopBar({ title, initial }: { title: string; initial: string }) {
  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-between px-5 py-3.5 backdrop-blur-xl border-b border-border/50"
      style={{ backgroundColor: 'rgb(250 250 247 / 0.85)' }}
    >
      <button
        type="button"
        aria-label="ย้อนกลับ"
        className="grid h-9 w-9 place-items-center rounded-full text-foreground hover:bg-accent -ml-1.5"
        onClick={() => window.history.back()}
      >
        <ChevronLeft className="size-5" strokeWidth={1.75} />
      </button>
      <div className="text-[13px] font-medium text-foreground tracking-tight leading-snug">{title}</div>
      <div className="relative -mr-1.5">
        <div
          className="grid h-9 w-9 place-items-center rounded-full text-[12px] font-semibold text-white shadow-lg shadow-emerald-500/30"
          style={{
            background:
              'linear-gradient(135deg, rgb(16 185 129) 0%, rgb(5 150 105) 60%, rgb(13 148 136) 100%)',
          }}
        >
          {initial}
        </div>
        <span
          className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2"
          style={{ boxShadow: '0 0 0 2px #fafaf7' }}
        />
      </div>
    </header>
  );
}

function InfoRow({
  icon,
  label,
  value,
  mono,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3.5 ${
        last ? '' : 'border-b border-border/50'
      }`}
    >
      <div className="grid h-8 w-8 place-items-center rounded-xl bg-muted/60 shrink-0">{icon}</div>
      <div className="text-[12px] text-muted-foreground leading-snug">{label}</div>
      <div
        className={`ml-auto text-[13.5px] font-medium text-foreground tracking-tight leading-snug ${
          mono ? 'font-mono tabular-nums' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ActionCard({
  href,
  icon,
  iconBg,
  iconShadow,
  label,
  sub,
}: {
  href: string;
  icon: React.ReactNode;
  iconBg: string;
  iconShadow: string;
  label: string;
  sub: string;
}) {
  return (
    <a
      href={href}
      className="flex items-center gap-3.5 rounded-[22px] border border-border/50 bg-card p-4 shadow-sm active:scale-[0.99] transition-transform"
    >
      <div
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white shadow-lg ${iconShadow}`}
        style={{ background: iconBg }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] font-semibold text-foreground tracking-tight leading-snug">
          {label}
        </div>
        <div className="mt-0.5 text-[11.5px] text-muted-foreground leading-snug">{sub}</div>
      </div>
      <ChevronRight className="size-4 text-muted-foreground shrink-0" strokeWidth={2} />
    </a>
  );
}
