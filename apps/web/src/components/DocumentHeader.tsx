import type { ReactNode } from 'react';

/** Presentation only: the caller supplies the correct issuing company. */
export default function DocumentHeader({ company, address, taxId, logoUrl, title, subtitle, number, date }: {
  company: string; address?: string; taxId?: string; logoUrl?: string | null;
  title: string; subtitle?: ReactNode; number?: string; date?: string;
}) {
  return <header className="bc-doc-header">
    <div className="bc-doc-brand">
      <img src={logoUrl || '/logo.svg'} alt={company} />
      <p className="bc-doc-company">{company}</p>
      {address && <p>{address}</p>}
      {taxId && <p>เลขประจำตัวผู้เสียภาษี {taxId}</p>}
    </div>
    <div className="bc-doc-identity">
      <h1>{title}</h1>
      {subtitle && <p className="bc-doc-kicker">{subtitle}</p>}
      {(number || date) && <div className="bc-doc-meta">
        {number && <><span>เลขที่เอกสาร</span><span>{number}</span></>}
        {date && <><span>วันที่</span><span>{date}</span></>}
      </div>}
    </div>
  </header>;
}
