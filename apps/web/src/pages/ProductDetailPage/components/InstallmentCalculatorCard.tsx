import { useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CalcState, CalcStatePatch, FinanceSide } from '../hooks/useInstallmentCalcState';
import type { GfinSettingsApi } from '../utils/gfinQuote';
import type { ProductForQuotes, ResolvedQuotes } from '../utils/resolveQuotes';
import { BcPanel } from './calc/BcPanel';
import { GfinPanel } from './calc/GfinPanel';
import { FinanceSwitch } from './calc/FinanceSwitch';
import { CompareRow, NoticeBox, formatBaht, formatTHB } from './calc/CalcRows';

interface Props {
  product: ProductForQuotes & { id: string };
  state: CalcState;
  /** ค่าที่คำนวณแล้วจาก resolveQuotes (หน้าเป็นคนคำนวณ เพื่อให้สรุปส่งลูกค้าใช้ชุดเดียวกัน) */
  quotes: ResolvedQuotes;
  onChange: (patch: CalcStatePatch) => void;
  /** เปิดตัวแก้ราคา — แทนลิงก์ตาย /products/:id/edit (B1) */
  onEditPrice: () => void;
  canEditPrice: boolean;
  gfinSettings?: GfinSettingsApi;
  /** ตารางดอกเบี้ย/ตาราง GFIN ยังโหลดอยู่ */
  loading: boolean;
}

const CONTRACT_ROLES = new Set(['OWNER', 'BRANCH_MANAGER', 'SALES']);

/**
 * เครื่องคำนวณค่างวดการ์ดเดียว สลับ BESTCHOICE | GFIN (แทน BcCalculatorCard + GfinCalculatorCard)
 * — mockup แนว A ที่เจ้าของเคาะ 2026-09-11
 */
export function InstallmentCalculatorCard({
  product,
  state,
  quotes,
  onChange,
  onEditPrice,
  canEditPrice,
  gfinSettings,
  loading,
}: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role ?? '';
  const isSales = role === 'SALES';
  const canCreateContract = CONTRACT_ROLES.has(role);

  if (quotes.installmentPrice == null) {
    return (
      <div className="rounded-md border border-warning/40 bg-warning/10 p-4 text-sm leading-snug">
        ยังไม่ได้กำหนดราคาเงินผ่อน
        {canEditPrice ? (
          <button type="button" onClick={onEditPrice} className="ml-2 underline text-warning-strong">
            ไปแก้ราคา
          </button>
        ) : (
          <span className="ml-2 text-warning-strong">— แจ้งผู้จัดการให้กำหนดราคา</span>
        )}
      </div>
    );
  }

  const { bc, gfin, gfinAvailable, installmentPrice } = quotes;
  const setFin = (fin: FinanceSide) => onChange({ fin });
  // ฝั่งที่แสดงจริง: เลือก GFIN ได้ต่อเมื่อคำนวณได้ · ไม่มีตารางดอกเบี้ย BESTCHOICE (เช่น iPad) → โชว์ GFIN
  const fin: FinanceSide =
    state.fin === 'gfin' && gfinAvailable ? 'gfin' : bc ? 'bc' : gfinAvailable ? 'gfin' : 'bc';

  const gfinCompareNotice = (() => {
    if (!gfin) {
      return loading ? 'กำลังโหลดตาราง GFIN...' : 'โหลดตาราง GFIN ไม่สำเร็จ — ลองรีเฟรช';
    }
    const gfinQuote = gfin.quote;
    if (gfinQuote.available) return null;
    switch (gfinQuote.reason) {
      case 'unsupported_category':
        return 'GFIN ไม่รับสินค้าหมวดนี้';
      case 'no_mapping':
        return 'GFIN: รุ่นนี้ไม่อยู่ในตารางราคาของ GFIN — เพิ่มใน ตั้งค่า → GFIN ถ้า GFIN รับ';
      case 'no_factor':
        return `GFIN: ยังไม่มีเรทสำหรับคอม ${gfin.commissionPct}% — เพิ่มใน ตั้งค่า → GFIN`;
      default:
        return null;
    }
  })();

  const commissionOptions = gfinSettings
    ? Array.from(
        new Set([
          gfinSettings.commissionPctByCategory.PHONE,
          gfinSettings.commissionPctByCategory.TABLET,
          ...(gfin ? [gfin.commissionPct] : []),
        ]),
      ).sort((a, b) => b - a)
    : gfin
      ? [gfin.commissionPct]
      : [];

  const body = (() => {
    if (fin === 'gfin' && gfin && gfin.quote.available && gfin.months != null && gfinSettings) {
      const q = gfin.quote;
      return (
        <GfinPanel
          gfin={{ ...gfin, months: gfin.months, quote: q }}
          settings={gfinSettings}
          installmentPrice={installmentPrice}
          isManager={!isSales}
          commissionOptions={commissionOptions}
          onMonthsChange={(months) =>
            onChange((prev) => ({ ...prev, gfin: { ...prev.gfin, months } }))
          }
          onDownPctChange={(downPct) =>
            onChange((prev) => ({ ...prev, gfin: { ...prev.gfin, downPct } }))
          }
          onCommissionChange={(commissionPct) =>
            onChange((prev) => ({ ...prev, gfin: { ...prev.gfin, commissionPct, months: null } }))
          }
          compare={
            bc ? (
              <CompareRow
                name="BESTCHOICE"
                tone="primary"
                monthly={formatTHB(bc.quote.result.monthlyPayment.toNumber())}
                detail={`ดาวน์ ${formatBaht(bc.downAmount)} ฿`}
                onSwitch={() => setFin('bc')}
              />
            ) : null
          }
        />
      );
    }
    if (bc) {
      return (
        <BcPanel
          bc={bc}
          minDownPct={Math.round(bc.minDownAmount === 0 ? 0 : (bc.minDownAmount / installmentPrice) * 100)}
          hideCommission={isSales}
          canCreateContract={canCreateContract}
          onMonthsChange={(months) => onChange((prev) => ({ ...prev, bc: { ...prev.bc, months } }))}
          onDownChange={(downAmount) =>
            onChange((prev) => ({ ...prev, bc: { ...prev.bc, downAmount } }))
          }
          onCreateContract={() =>
            navigate(
              `/contracts/create?productId=${product.id}&downAmount=${bc.downAmount}&months=${bc.months}`,
            )
          }
          compare={
            gfin?.quote.available ? (
              <CompareRow
                name="GFIN"
                tone="info"
                monthly={formatBaht(gfin.quote.result.monthlyPayment.toNumber())}
                detail={`ลูกค้าดาวน์จริง ${formatBaht(gfin.quote.result.downAmountActual.toNumber())} ฿ · คอม ${gfin.commissionPct}%`}
                onSwitch={() => setFin('gfin')}
              />
            ) : gfinCompareNotice ? (
              <NoticeBox>{gfinCompareNotice}</NoticeBox>
            ) : null
          }
        />
      );
    }
    if (loading) {
      return <div className="text-sm text-muted-foreground leading-snug">กำลังโหลด config...</div>;
    }
    return (
      <NoticeBox>
        ไม่มีตารางดอกเบี้ย BESTCHOICE สำหรับหมวดนี้
        {gfinCompareNotice ? ` · ${gfinCompareNotice}` : ''}
      </NoticeBox>
    );
  })();

  return (
    <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
      <CardHeader>
        <CardTitle>คำนวณค่างวด</CardTitle>
        <span className="text-xs text-muted-foreground leading-snug">
          คิดจากราคาผ่อน{' '}
          <span className="font-mono tabular-nums">{formatBaht(installmentPrice)}</span> ฿
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <FinanceSwitch value={fin} onChange={setFin} gfinDisabled={!gfinAvailable} />
        {body}
      </CardContent>
    </Card>
  );
}
