interface WarrantyInfo {
  shopWarrantyDays?: number | null;
  warrantyTerms?: string | null;
}

export function WarrantyDetails({ warranty }: { warranty: WarrantyInfo }) {
  const days = warranty.shopWarrantyDays;
  const terms = warranty.warrantyTerms?.trim();
  return (
    <section aria-label="ประกันเครื่องนี้" className="rounded-2xl border border-border p-4 md:p-5">
      <h2 className="font-semibold text-base leading-snug">ประกันเครื่องนี้</h2>
      <p className="mt-2 text-sm font-medium leading-snug">
        {days == null ? 'ระยะเวลาประกันร้าน: สอบถามร้าน'
          : days === 0 ? 'ไม่มีประกันร้าน' : `ประกันร้าน ${days} วัน`}
      </p>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground leading-relaxed">
        {terms || 'สอบถามเงื่อนไขและความคุ้มครองประกันของเครื่องนี้กับร้านก่อนสั่งซื้อ'}
      </p>
    </section>
  );
}
