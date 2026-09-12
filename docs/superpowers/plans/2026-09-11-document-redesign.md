# Paper-first document redesign

Owner requests redesign of ten document families and receipts consistent with the accepted payment receipt/credit note. Preserve TH Sarabun PSK 16 pt body, 18 pt headings, 12 pt footers and all financial/legal content.

Design: emerald document identity, company left / document number and date right, thin rules, aligned numeric columns, compact party metadata, one emphasized net amount. Use 14 mm top/bottom and 15 mm side margins for transaction forms; compact prose layout for termination letters. Receipts and vouchers keep totals/acknowledgment with signatures so a closing page never consists only of signatures. Long tables may continue, with their closing summary on the final page. One page is required for normal termination letters and ordinary short forms; never clip or silently remove data to force it.

UX skill search returned web-oriented patterns, so paper geometry uses the existing accepted receipt and general hierarchy/contrast/consistency guidance. Do not adopt web CTAs, animations or suggested replacement fonts.

- [x] Shared transaction visual system and React document header/closing layout.
- [x] Trade-in, e-tax, collections report, termination letter and receipt-family redesign.
- [x] Standard/petty cash/payroll vouchers, WHT certificates, daily summary.
- [x] Render normal/long fixtures and inspect every output page; assert short-form page counts and closing content/signature co-location.
- [x] Read-only review, isolated regression, final local check and fresh preview. Local commit; no deployment.
