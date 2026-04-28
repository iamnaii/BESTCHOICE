import { CreditCard, AlertTriangle, ExternalLink } from 'lucide-react';

/**
 * Compact preview card shown in the inbox when staff sends a payment Flex Card
 * via LINE Finance. Mimics the bubble customers see in LINE so staff have
 * visual confirmation without parsing raw URLs.
 *
 * Encoded by line-oa-payment.controller.ts as:
 *   [flex:payment-reminder|<contractNo>|<inst>/<total>|<amount>|<dueDate>|<daysUntilDue>] <url>
 *   [flex:overdue-notice|<contractNo>|<overdueCount>|<amount>|<lateFee>|<oldestDueDate>] <url>
 */

const FLEX_REGEX = /^\[flex:(payment-reminder|overdue-notice)\|([^\]]+)\]\s+(https?:\/\/\S+)/;

export interface ParsedPaymentFlex {
  kind: 'payment-reminder' | 'overdue-notice';
  contractNumber: string;
  amount: number;
  url: string;
  // reminder-only
  installmentLabel?: string;
  dueDate?: string;
  daysUntilDue?: number;
  // overdue-only
  overdueCount?: number;
  lateFee?: number;
  oldestDueDate?: string;
}

export function parsePaymentFlex(text: string | null | undefined): ParsedPaymentFlex | null {
  if (!text) return null;
  const m = text.match(FLEX_REGEX);
  if (!m) return null;
  const [, kind, payload, url] = m;
  const parts = payload.split('|');

  if (kind === 'payment-reminder') {
    const [contractNumber, installmentLabel, amountStr, dueDate, daysStr] = parts;
    const amount = Number(amountStr);
    if (!Number.isFinite(amount)) return null;
    return {
      kind: 'payment-reminder',
      contractNumber,
      installmentLabel,
      amount,
      dueDate,
      daysUntilDue: Number(daysStr),
      url,
    };
  }

  // overdue-notice
  const [contractNumber, overdueCountStr, amountStr, lateFeeStr, oldestDueDate] = parts;
  const amount = Number(amountStr);
  if (!Number.isFinite(amount)) return null;
  return {
    kind: 'overdue-notice',
    contractNumber,
    amount,
    overdueCount: Number(overdueCountStr),
    lateFee: Number(lateFeeStr),
    oldestDueDate,
    url,
  };
}

const formatBaht = (n: number) =>
  n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PaymentFlexPreview({ data }: { data: ParsedPaymentFlex }) {
  if (data.kind === 'overdue-notice') {
    return (
      <div className="w-[260px] rounded-2xl overflow-hidden border border-border bg-card shadow-sm">
        <div className="px-3.5 py-2.5 text-white bg-gradient-to-br from-red-500 to-red-700">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] opacity-90 leading-snug">BESTCHOICE FINANCE</div>
              <div className="text-sm font-semibold leading-snug mt-0.5 flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" />
                แจ้งค้างชำระ
              </div>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/25 font-semibold whitespace-nowrap">
              {data.overdueCount} งวด
            </span>
          </div>
        </div>
        <div className="px-3.5 py-3">
          <div className="rounded-lg p-3 mb-2.5 bg-red-50 border border-red-100">
            <div className="text-[10px] text-muted-foreground">ยอดค้างชำระ</div>
            <div className="text-xl font-bold text-red-600 leading-tight my-1">
              ฿{formatBaht(data.amount)}
            </div>
            {data.oldestDueDate && (
              <div className="text-[11px] text-muted-foreground">
                ครบกำหนดเมื่อ {data.oldestDueDate}
              </div>
            )}
          </div>
          <div className="flex justify-between text-xs py-1">
            <span className="text-muted-foreground">สัญญา</span>
            <span className="font-semibold">{data.contractNumber}</span>
          </div>
          {!!data.lateFee && data.lateFee > 0 && (
            <div className="flex justify-between text-xs py-1">
              <span className="text-muted-foreground">ค่าปรับล่าช้า</span>
              <span className="font-semibold text-red-600">฿{formatBaht(data.lateFee)}</span>
            </div>
          )}
        </div>
        <FlexFooter url={data.url} />
      </div>
    );
  }

  // payment-reminder
  const days = data.daysUntilDue ?? 0;
  const isUrgent = days <= 1;
  const headerClass = isUrgent
    ? 'bg-gradient-to-br from-amber-500 to-orange-600'
    : 'bg-gradient-to-br from-emerald-500 to-emerald-700';
  const badgeText = days === 0 ? 'วันนี้' : days === 1 ? 'พรุ่งนี้' : `อีก ${days} วัน`;
  const amountClass = isUrgent ? 'text-orange-600' : 'text-emerald-600';
  const cardBg = isUrgent ? 'bg-orange-50 border-orange-100' : 'bg-emerald-50 border-emerald-100';

  return (
    <div className="w-[260px] rounded-2xl overflow-hidden border border-border bg-card shadow-sm">
      <div className={`px-3.5 py-2.5 text-white ${headerClass}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] opacity-90 leading-snug">BESTCHOICE FINANCE</div>
            <div className="text-sm font-semibold leading-snug mt-0.5 flex items-center gap-1.5">
              <CreditCard className="size-3.5" />
              แจ้งเตือนค่างวด
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/25 font-semibold whitespace-nowrap">
            {badgeText}
          </span>
        </div>
      </div>
      <div className="px-3.5 py-3">
        <div className={`rounded-lg p-3 mb-2.5 border ${cardBg}`}>
          <div className="text-[10px] text-muted-foreground">
            ยอดชำระ {data.installmentLabel ? `· งวด ${data.installmentLabel}` : ''}
          </div>
          <div className={`text-xl font-bold leading-tight my-1 ${amountClass}`}>
            ฿{formatBaht(data.amount)}
          </div>
          {data.dueDate && (
            <div className="text-[11px] text-muted-foreground">ครบกำหนด {data.dueDate}</div>
          )}
        </div>
        <div className="flex justify-between text-xs py-1">
          <span className="text-muted-foreground">สัญญา</span>
          <span className="font-semibold">{data.contractNumber}</span>
        </div>
      </div>
      <FlexFooter url={data.url} />
    </div>
  );
}

function FlexFooter({ url }: { url: string }) {
  return (
    <div className="px-3.5 py-1.5 bg-muted/50 border-t border-border flex items-center justify-between">
      <span className="text-[9px] text-muted-foreground">Flex Card · ส่งให้ลูกค้าใน LINE แล้ว</span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[9px] text-info hover:underline inline-flex items-center gap-0.5"
      >
        เปิดลิงก์
        <ExternalLink className="size-2.5" />
      </a>
    </div>
  );
}
