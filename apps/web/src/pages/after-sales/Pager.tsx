interface PagerProps {
  page: number;
  totalPages: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

/** B2 (final-fix brief) — pager ใต้ตารางเคส: "หน้า X / Y · ทั้งหมด N เคส" + ก่อนหน้า/ถัดไป */
export default function Pager({ page, totalPages, total, onPrev, onNext }: PagerProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm leading-snug text-muted-foreground">
      <span>
        หน้า {page} / {totalPages} · ทั้งหมด {total} เคส
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          aria-label="หน้าก่อนหน้า"
          disabled={page <= 1}
          onClick={onPrev}
          className="min-h-9 rounded-lg border border-border bg-card px-3 text-sm leading-snug text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          ก่อนหน้า
        </button>
        <button
          type="button"
          aria-label="หน้าถัดไป"
          disabled={page >= totalPages}
          onClick={onNext}
          className="min-h-9 rounded-lg border border-border bg-card px-3 text-sm leading-snug text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          ถัดไป
        </button>
      </div>
    </div>
  );
}
