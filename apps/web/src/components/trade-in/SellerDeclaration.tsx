import { TRADE_IN_DECLARATION_CLAUSES } from '@installment/shared';

export default function SellerDeclaration() {
  return (
    <section aria-label="คำรับรองผู้ขายก่อนลงนาม" className="rounded-lg border bg-muted/20 p-3 text-sm">
      <h3 className="font-semibold">คำรับรองผู้ขาย — โปรดอ่านก่อนลงนาม</h3>
      <ol className="mt-2 list-decimal space-y-2 pl-5 leading-relaxed">
        {TRADE_IN_DECLARATION_CLAUSES.map((clause) => <li key={clause}>{clause}</li>)}
      </ol>
    </section>
  );
}
