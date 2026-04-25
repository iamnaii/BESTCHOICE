import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ShortcutGroup {
  title: string;
  rows: Array<{ keys: string[]; label: string }>;
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'ทั่วไป',
    rows: [
      { keys: ['?'], label: 'เปิด/ปิดหน้าช่วยเหลือ' },
      { keys: ['Esc'], label: 'ปิด dialog หรือยกเลิก G-prefix' },
      { keys: ['/'], label: 'โฟกัสช่องค้นหา' },
    ],
  },
  {
    title: 'สลับแท็บ (กด G แล้วตามด้วย…)',
    rows: [
      { keys: ['G', 'Q'], label: 'คิววันนี้' },
      { keys: ['G', 'F'], label: 'ติดตามต่อเนื่อง' },
      { keys: ['G', 'P'], label: 'นัดชำระ' },
      { keys: ['G', 'A'], label: 'รออนุมัติ' },
      { keys: ['G', 'N'], label: 'วิเคราะห์ (Analytics)' },
      { keys: ['G', 'L'], label: 'ทั้งหมด' },
    ],
  },
  {
    title: 'การ์ดในคิว',
    rows: [
      { keys: ['J', '↓'], label: 'ย้ายโฟกัสลง' },
      { keys: ['K', '↑'], label: 'ย้ายโฟกัสขึ้น' },
      { keys: ['Enter'], label: 'เปิด Customer 360' },
      { keys: ['L'], label: 'ส่ง LINE' },
      { keys: ['C'], label: 'บันทึกการโทร' },
      { keys: ['P'], label: 'บันทึกชำระเงิน' },
      { keys: ['S'], label: 'Snooze' },
      { keys: ['A'], label: 'มอบหมาย / Assign' },
    ],
  },
];

function KeyCap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-[1.75rem] items-center justify-center rounded-md border border-border bg-muted px-1.5 py-0.5 text-2xs font-mono font-medium text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

export default function KeyboardShortcutsOverlay({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>แป้นพิมพ์ลัด</DialogTitle>
          <DialogDescription>กด ? อีกครั้ง หรือ Esc เพื่อปิดหน้านี้</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2 sm:gap-6">
          {GROUPS.map((g) => (
            <section key={g.title} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.title}
              </h3>
              <ul className="space-y-1.5">
                {g.rows.map((row) => (
                  <li
                    key={row.label}
                    className="flex items-center justify-between gap-3 text-sm leading-snug"
                  >
                    <span className="text-foreground">{row.label}</span>
                    <span className="flex items-center gap-1">
                      {row.keys.map((k, idx) => (
                        <span key={`${row.label}-${k}-${idx}`} className="flex items-center gap-1">
                          {idx > 0 && (
                            <span className="text-2xs text-muted-foreground">แล้ว</span>
                          )}
                          <KeyCap>{k}</KeyCap>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
