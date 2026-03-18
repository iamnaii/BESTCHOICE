import { useState } from 'react';

interface StepContractReviewProps {
  contractId: string;
  previewHtml: string | null;
  onComplete: () => void;
  onBack: () => void;
}

export default function StepContractReview({ previewHtml, onComplete, onBack }: StepContractReviewProps) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="flex flex-col h-full px-4 max-w-3xl mx-auto py-4">
      <h2 className="text-xl font-semibold text-foreground mb-4 text-center">อ่านรายละเอียดสัญญา</h2>

      {/* Contract preview - full height */}
      <div className="flex-1 rounded-xl border-2 border-border overflow-hidden bg-white mb-4" style={{ minHeight: '50vh' }}>
        {previewHtml ? (
          <ContractIframe html={previewHtml} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}
      </div>

      {/* Confirmation checkbox */}
      <label className="flex items-start gap-3 mb-4 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 w-5 h-5 rounded border-2 border-input accent-primary"
        />
        <span className="text-sm text-foreground leading-snug">
          ข้าพเจ้าได้อ่านและเข้าใจเงื่อนไขทั้งหมดในสัญญาฉบับนี้แล้ว
        </span>
      </label>

      {/* Navigation buttons */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-6 py-3.5 text-sm border border-input rounded-xl hover:bg-muted"
        >
          ย้อนกลับ
        </button>
        <div className="flex-1" />
        <button
          onClick={onComplete}
          disabled={!confirmed}
          className="px-8 py-3.5 text-sm bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 disabled:opacity-50 font-medium"
        >
          เซ็นสัญญา
        </button>
      </div>
    </div>
  );
}

function ContractIframe({ html }: { html: string }) {
  return (
    <iframe
      title="contract-preview"
      className="w-full h-full border-0"
      srcDoc={html}
      sandbox="allow-same-origin"
    />
  );
}
