import { useState } from 'react';

export type ContractPreviewState = 'loading' | 'error' | 'ready';

interface StepContractReviewProps {
  contractId: string;
  previewHtml: string | null;
  previewState: ContractPreviewState;
  onRetryPreview: () => void;
  onComplete: () => void;
  onBack: () => void;
}

export default function StepContractReview(props: StepContractReviewProps) {
  // Consent belongs to this rendered document, not a previous contract or a
  // failed request. A new response/state starts with a fresh iframe and consent.
  return <ContractReview key={`${props.contractId}:${props.previewState}:${props.previewHtml}`} {...props} />;
}

function ContractReview({ previewHtml, previewState, onRetryPreview, onComplete, onBack }: StepContractReviewProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [rendered, setRendered] = useState(false);
  const hasDocument = Boolean(previewHtml?.trim());
  const canConfirm = previewState === 'ready' && hasDocument && rendered;
  const canContinue = canConfirm && confirmed;

  return (
    <div className="flex flex-col px-4 max-w-3xl mx-auto py-4" style={{ minHeight: 'calc(100vh - 180px)' }}>
      <h2 className="text-xl font-semibold text-foreground mb-4 text-center">อ่านรายละเอียดสัญญา</h2>

      {/* Contract preview - full height */}
      <div className="flex-1 flex flex-col rounded-xl border-2 border-border overflow-hidden bg-card mb-4" style={{ minHeight: '65vh' }}>
        {previewState === 'ready' && hasDocument ? (
          <ContractIframe html={previewHtml!} onLoad={() => setRendered(true)} />
        ) : previewState === 'loading' ? (
          <div role="status" className="flex flex-col gap-3 items-center justify-center flex-1">
            <div aria-hidden="true" className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            <p className="text-sm text-muted-foreground">กำลังโหลดเอกสารสัญญา</p>
          </div>
        ) : (
          <div role="alert" className="flex flex-col gap-3 items-center justify-center flex-1 p-4">
            <p className="text-sm text-destructive">โหลดเอกสารสัญญาไม่สำเร็จ</p>
            <button type="button" onClick={onRetryPreview}
              className="rounded-lg border border-input px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              ลองใหม่
            </button>
          </div>
        )}
      </div>

      {/* Confirmation checkbox */}
      <label className="flex items-start gap-3 mb-4 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={!canConfirm}
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
          onClick={() => { if (canContinue) onComplete(); }}
          disabled={!canContinue}
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
  /* Fix font loading in srcDoc iframe — use absolute URLs */
  @font-face {
    font-family: 'TH Sarabun PSK';
    src: url('/fonts/THSarabunPSK-Regular.ttf') format('truetype');
    font-weight: 400; font-style: normal; font-display: swap;
  }
  @font-face {
    font-family: 'TH Sarabun PSK';
    src: url('/fonts/THSarabunPSK-Bold.ttf') format('truetype');
    font-weight: 700; font-style: normal; font-display: swap;
  }
  /* Force TH Sarabun PSK everywhere */
  html, body, div, p, td, th, span, strong, u, h1, h2, h3, h4, h5, h6 {
    font-family: 'TH Sarabun PSK', 'Sarabun', sans-serif !important;
  }
  /* Prevent horizontal overflow only */
  html, body {
    overflow-x: hidden !important;
    max-width: 100% !important;
    box-sizing: border-box !important;
  }
  /* Compact mode: remove A4 paper simulation, show as continuous scroll */
  body { background: #fff !important; padding: 0 !important; }
  .a4-page {
    width: 100% !important;
    min-height: auto !important;
    padding: 16px 20px !important;
    margin: 0 !important;
    box-shadow: none !important;
    border-bottom: 1px dashed #d1d5db;
  }
  .a4-page:last-child { border-bottom: none; }
  /* Responsive images/tables */
  img, table, pre, svg {
    max-width: 100% !important;
  }
  /* Thin modern scrollbar */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
  html { scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
</style>
`;

function ContractIframe({ html, onLoad }: { html: string; onLoad: () => void }) {
  // Strip Google Fonts links — force local TH Sarabun PSK only
  let cleaned = html.replace(/<link[^>]*fonts\.googleapis\.com[^>]*>/gi, '');
  cleaned = cleaned.replace(/<link[^>]*fonts\.gstatic\.com[^>]*>/gi, '');

  // Inject <base> tag so srcDoc iframe can resolve relative font/image URLs
  const baseTag = `<base href="${window.location.origin}/" />`;
  const injection = `${baseTag}${IFRAME_STYLE}`;
  const styledHtml = cleaned.includes('</head>')
    ? cleaned.replace('</head>', `${injection}</head>`)
    : cleaned.includes('<head>')
      ? cleaned.replace('<head>', `<head>${injection}`)
      : `<html><head>${injection}</head><body>${cleaned}</body></html>`;

  return (
    <iframe
      title="contract-preview"
      className="w-full flex-1 border-0"
      style={{ minHeight: 0 }}
      srcDoc={styledHtml}
      onLoad={onLoad}
      sandbox="allow-same-origin"
    />
  );
}
