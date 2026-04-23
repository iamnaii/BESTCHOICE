import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getStatusBadgeProps, creditCheckStatusMap } from '@/lib/status-badges';
import { formatDateShort, formatDateTime } from '@/utils/formatters';
import { Brain, Pencil, FileText, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { AiAnalysisData } from './types';

export interface CreditCheckItem {
  id: string;
  status: string;
  bankName: string | null;
  statementFiles: string[];
  statementMonths: number;
  aiScore: number | null;
  aiSummary: string | null;
  aiRecommendation: string | null;
  aiAnalysis: Record<string, unknown> | null;
  reviewNotes: string | null;
  checkedBy: { id: string; name: string } | null;
  checkedAt?: string | null;
  contract: { id: string; contractNumber: string } | null;
  createdAt: string;
}

interface Props {
  cc: CreditCheckItem;
  canOverride: boolean;
  isAnalyzing: boolean;
  onAnalyze: (id: string) => void;
  onOverride: (id: string) => void;
  onViewStatement?: (url: string) => void;
}

function riskFromScore(score: number | null) {
  if (score === null) return { label: 'รอวิเคราะห์', tone: 'muted' as const };
  if (score >= 70) return { label: 'ความเสี่ยงต่ำ', tone: 'success' as const };
  if (score >= 50) return { label: 'ความเสี่ยงปานกลาง', tone: 'warning' as const };
  if (score >= 40) return { label: 'ต้องตรวจเพิ่ม', tone: 'warning' as const };
  return { label: 'ความเสี่ยงสูง', tone: 'destructive' as const };
}

export default function CreditCheckCard({
  cc,
  canOverride,
  isAnalyzing,
  onAnalyze,
  onOverride,
  onViewStatement,
}: Props) {
  const csCfg = getStatusBadgeProps(cc.status, creditCheckStatusMap);
  const ai = cc.aiAnalysis as AiAnalysisData | null;
  const risk = riskFromScore(cc.aiScore);
  // Only show AI risk badge when it adds info beyond the status badge:
  // - status=PENDING + score present: status says "รอวิเคราะห์" but AI already has an opinion
  // Otherwise the status badge alone is authoritative, and the numeric score
  // bar below still shows AI's view (avoids redundant/contradictory badges).
  const showRiskBadge = cc.status === 'PENDING' && cc.aiScore !== null;
  const scoreColor =
    cc.aiScore === null
      ? 'text-muted-foreground'
      : cc.aiScore >= 70
        ? 'text-success'
        : cc.aiScore >= 50
          ? 'text-warning'
          : 'text-destructive';
  const scoreBg =
    cc.aiScore === null
      ? 'bg-muted'
      : cc.aiScore >= 70
        ? 'bg-success'
        : cc.aiScore >= 50
          ? 'bg-warning'
          : 'bg-destructive';

  return (
    <div className="border border-border/60 rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant={csCfg.variant} appearance={csCfg.appearance} size="sm">
            {csCfg.label}
          </Badge>
          {showRiskBadge && (
            <Badge
              variant={risk.tone === 'muted' ? 'secondary' : risk.tone}
              appearance="light"
              size="sm"
            >
              {risk.label}
            </Badge>
          )}
          {cc.bankName && <span className="text-xs text-muted-foreground">ธนาคาร: {cc.bankName}</span>}
          <span className="text-xs text-muted-foreground">{formatDateShort(cc.createdAt)}</span>
          {cc.statementMonths > 0 && (
            <span className="text-xs text-muted-foreground">Statement {cc.statementMonths} เดือน</span>
          )}
          {cc.contract && (
            <span className="text-xs text-primary">สัญญา: {cc.contract.contractNumber}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {cc.status === 'PENDING' && (
            <Button size="sm" variant="primary" onClick={() => onAnalyze(cc.id)} disabled={isAnalyzing}>
              <Brain className="size-3.5" />
              {isAnalyzing ? 'กำลังวิเคราะห์...' : 'AI วิเคราะห์'}
            </Button>
          )}
          {canOverride && cc.aiScore !== null && (
            <Button size="sm" variant="outline" onClick={() => onOverride(cc.id)}>
              <Pencil className="size-3.5" />
              ปรับแก้สถานะ
            </Button>
          )}
        </div>
      </div>

      {cc.aiScore !== null && (
        <div className="flex items-center gap-4">
          <div className={`text-3xl font-bold tabular-nums ${scoreColor}`}>{cc.aiScore}</div>
          <div className="flex-1">
            <div className="text-xs text-muted-foreground mb-1">คะแนน AI (เต็ม 100)</div>
            <div className="w-full bg-muted rounded-full h-2">
              <div className={`h-2 rounded-full ${scoreBg}`} style={{ width: `${cc.aiScore}%` }} />
            </div>
          </div>
        </div>
      )}

      {ai && (ai.monthlyIncome != null || ai.averageBalance != null || ai.affordabilityRatio != null || ai.incomeConsistency) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {ai.monthlyIncome != null && (
            <div className="bg-muted/40 rounded-lg border border-border/50 p-2.5">
              <div className="text-2xs text-muted-foreground">รายได้เฉลี่ย/เดือน</div>
              <div className="text-sm font-bold mt-0.5 tabular-nums">{Number(ai.monthlyIncome).toLocaleString()} ฿</div>
            </div>
          )}
          {ai.averageBalance != null && (
            <div className="bg-muted/40 rounded-lg border border-border/50 p-2.5">
              <div className="text-2xs text-muted-foreground">ยอดเงินเฉลี่ย</div>
              <div className="text-sm font-bold mt-0.5 tabular-nums">{Number(ai.averageBalance).toLocaleString()} ฿</div>
            </div>
          )}
          {ai.affordabilityRatio != null && (
            <div className="bg-muted/40 rounded-lg border border-border/50 p-2.5">
              <div className="text-2xs text-muted-foreground">อัตราภาระหนี้</div>
              <div className="text-sm font-bold mt-0.5 tabular-nums">
                {(Number(ai.affordabilityRatio) * 100).toFixed(1)}%
              </div>
            </div>
          )}
          {ai.incomeConsistency && (
            <div className="bg-muted/40 rounded-lg border border-border/50 p-2.5">
              <div className="text-2xs text-muted-foreground">ความสม่ำเสมอรายได้</div>
              <div
                className={`text-sm font-bold mt-0.5 ${ai.incomeConsistency === 'stable' ? 'text-success' : 'text-warning'}`}
              >
                {ai.incomeConsistency === 'stable' ? 'สม่ำเสมอ' : 'ไม่สม่ำเสมอ'}
              </div>
            </div>
          )}
        </div>
      )}

      {ai && (ai.positiveFactors?.length || ai.riskFactors?.length) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {!!ai.positiveFactors?.length && (
            <div className="bg-success/5 border border-success/20 rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 mb-1 text-xs font-semibold text-success">
                <CheckCircle2 className="size-3.5" />
                ปัจจัยบวก
              </div>
              <ul className="text-xs text-foreground space-y-0.5">
                {ai.positiveFactors.map((f, i) => (
                  <li key={i} className="pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-success">{f}</li>
                ))}
              </ul>
            </div>
          )}
          {!!ai.riskFactors?.length && (
            <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 mb-1 text-xs font-semibold text-destructive">
                <AlertTriangle className="size-3.5" />
                ปัจจัยเสี่ยง
              </div>
              <ul className="text-xs text-foreground space-y-0.5">
                {ai.riskFactors.map((f, i) => (
                  <li key={i} className="pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-destructive">{f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {cc.aiSummary && <div className="text-xs text-muted-foreground">{cc.aiSummary}</div>}

      {cc.aiRecommendation && (
        <div
          className={`text-xs font-medium p-2 rounded ${
            cc.aiScore && cc.aiScore >= 70
              ? 'bg-success/5 dark:bg-success/10 text-success'
              : cc.aiScore && cc.aiScore >= 50
                ? 'bg-warning/10 text-warning'
                : 'bg-destructive/5 dark:bg-destructive/10 text-destructive'
          }`}
        >
          {cc.aiRecommendation}
        </div>
      )}

      {cc.statementFiles.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">ไฟล์ Statement:</span>
          {cc.statementFiles.map((url, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onViewStatement?.(url)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted hover:bg-accent text-xs"
            >
              <FileText className="size-3" />
              ไฟล์ {i + 1}
            </button>
          ))}
        </div>
      )}

      {cc.checkedBy && (
        <div className="text-xs text-primary pt-1 border-t border-border/40">
          ตรวจสอบโดย: <span className="font-medium">{cc.checkedBy.name}</span>
          {cc.checkedAt && <span className="text-muted-foreground"> · {formatDateTime(cc.checkedAt)}</span>}
          {cc.reviewNotes && <div className="text-xs text-muted-foreground mt-0.5">หมายเหตุ: {cc.reviewNotes}</div>}
        </div>
      )}
    </div>
  );
}
