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
    <div className="flex flex-col px-4 max-w-3xl mx-auto py-4" style={{ minHeight: 'calc(100vh - 180px)' }}>
      <h2 className="text-xl font-semibold text-foreground mb-4 text-center">อ่านรายละเอียดสัญญา</h2>

      {/* Contract preview - full height */}
      <div className="flex-1 rounded-xl border-2 border-border overflow-hidden bg-white mb-4" style={{ minHeight: '65vh' }}>
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

const IFRAME_STYLE = `
<style>
  html, body {
    overflow-x: hidden !important;
    max-width: 100% !important;
    box-sizing: border-box !important;
    width: 100% !important;
  }
  body {
    padding: 16px !important;
    margin: 0 !important;
  }
  /* Force all fixed-width containers to fill available width */
  body > * {
    max-width: 100% !important;
    width: 100% !important;
    box-sizing: border-box !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
  }
  .page, [class*="page"], [style*="width"] {
    max-width: 100% !important;
    width: 100% !important;
    box-sizing: border-box !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
    padding-left: 16px !important;
    padding-right: 16px !important;
  }
  img, table, pre, svg {
    max-width: 100% !important;
    height: auto !important;
  }
  /* Thin modern scrollbar */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
  html { scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
</style>
`;

function ContractIframe({ html }: { html: string }) {
  // Inject styles to prevent horizontal overflow and style scrollbar
  const styledHtml = html.includes('</head>')
    ? html.replace('</head>', `${IFRAME_STYLE}</head>`)
    : `${IFRAME_STYLE}${html}`;

  return (
    <iframe
      title="contract-preview"
      className="w-full h-full border-0"
      srcDoc={styledHtml}
      sandbox="allow-same-origin"
    />
  );
}
