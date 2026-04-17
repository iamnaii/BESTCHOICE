import { type CreditCheckItem, type AiAnalysisData } from './types';

interface CreditCheckDetailProps {
  creditCheck: CreditCheckItem;
  onClose: () => void;
}

export default function CreditCheckDetail({ creditCheck: cc, onClose }: CreditCheckDetailProps) {
  const ai = cc.aiAnalysis as AiAnalysisData | null;

  return (
    <div className="mt-2 mb-4 bg-card rounded-xl border border-border/50 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">
          รายละเอียดการวิเคราะห์ AI — {cc.customer.name}
        </h4>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-muted transition-colors">
          ปิด
        </button>
      </div>

      {ai ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {ai.monthlyIncome != null && (
            <div className="bg-muted/40 rounded-xl border border-border/50 p-3">
              <div className="text-xs text-muted-foreground">รายได้เฉลี่ย/เดือน</div>
              <div className="text-sm font-bold mt-1">{Number(ai.monthlyIncome).toLocaleString()} ฿</div>
            </div>
          )}
          {ai.averageBalance != null && (
            <div className="bg-muted/40 rounded-xl border border-border/50 p-3">
              <div className="text-xs text-muted-foreground">ยอดเงินเฉลี่ย</div>
              <div className="text-sm font-bold mt-1">{Number(ai.averageBalance).toLocaleString()} ฿</div>
            </div>
          )}
          {ai.affordabilityRatio != null && (
            <div className="bg-muted/40 rounded-xl border border-border/50 p-3">
              <div className="text-xs text-muted-foreground">อัตราภาระหนี้</div>
              <div className="text-sm font-bold mt-1">
                {((ai.affordabilityRatio ?? 0) * 100).toFixed(1)}%
              </div>
            </div>
          )}
          {ai.incomeConsistency && (
            <div className="bg-muted/40 rounded-xl border border-border/50 p-3">
              <div className="text-xs text-muted-foreground">ความสม่ำเสมอรายได้</div>
              <div
                className={`text-sm font-bold mt-1 ${ai.incomeConsistency === 'stable' ? 'text-success' : 'text-warning'}`}
              >
                {ai.incomeConsistency === 'stable' ? 'สม่ำเสมอ' : 'ไม่สม่ำเสมอ'}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">ยังไม่มีข้อมูลจากการวิเคราะห์ AI</div>
      )}

      {/* Risk & Positive factors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {ai?.riskFactors && ai.riskFactors.length > 0 && (
          <div className="bg-destructive/5 dark:bg-destructive/10 border border-destructive/20 rounded p-3">
            <div className="text-xs font-medium text-destructive mb-1">ปัจจัยเสี่ยง</div>
            <ul className="space-y-1">
              {ai.riskFactors.map((f, i) => (
                <li key={i} className="text-xs text-destructive flex items-start gap-1">
                  <span className="mt-0.5">•</span> {f}
                </li>
              ))}
            </ul>
          </div>
        )}
        {ai?.positiveFactors && ai.positiveFactors.length > 0 && (
          <div className="bg-success/5 dark:bg-success/10 border border-success/20 rounded p-3">
            <div className="text-xs font-medium text-success mb-1">ปัจจัยบวก</div>
            <ul className="space-y-1">
              {ai.positiveFactors.map((f, i) => (
                <li key={i} className="text-xs text-success flex items-start gap-1">
                  <span className="mt-0.5">•</span> {f}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* AI Summary & Recommendation */}
      {(cc.aiSummary || cc.aiRecommendation) && (
        <div className="space-y-2">
          {cc.aiSummary && (
            <div className="bg-card rounded border p-3">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                สรุปผลวิเคราะห์
              </div>
              <div className="text-sm">{cc.aiSummary}</div>
            </div>
          )}
          {cc.aiRecommendation && (
            <div className="bg-card rounded border p-3">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                คำแนะนำ
              </div>
              <div className="text-sm">{cc.aiRecommendation}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
