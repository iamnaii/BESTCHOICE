import { X } from 'lucide-react';

interface ShortcutsHelpOverlayProps {
  onClose: () => void;
}

interface ShortcutEntry {
  keys: string[];
  description: string;
}

const shortcuts: ShortcutEntry[] = [
  { keys: ['Ctrl', 'K'], description: 'เปิด Command Palette' },
  { keys: ['Ctrl', '/'], description: 'โฟกัสช่องค้นหา' },
  { keys: ['Alt', 'N'], description: 'สร้างสัญญาใหม่' },
  { keys: ['Alt', 'C'], description: 'ไปหน้าลูกค้า' },
  { keys: ['Alt', 'P'], description: 'ไปหน้าชำระเงิน' },
  { keys: ['Alt', 'S'], description: 'ไปหน้าคลังสินค้า' },
  { keys: ['Alt', 'D'], description: 'ไปหน้าหลัก' },
  { keys: ['Esc'], description: 'ปิด modal / ยกเลิกโฟกัส' },
  { keys: ['Shift', '?'], description: 'เปิด/ปิดหน้าต่างนี้' },
];

export default function ShortcutsHelpOverlay({ onClose }: ShortcutsHelpOverlayProps) {
  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-xs animate-in fade-in-0 duration-150"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed left-1/2 top-[15%] z-50 w-full max-w-md -translate-x-1/2 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150">
        <div className="rounded-xl border border-border bg-popover shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold text-foreground">คีย์ลัด</h2>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Shortcut List */}
          <div className="px-5 py-3 space-y-2.5">
            {shortcuts.map((shortcut, i) => (
              <div key={i} className="flex items-center justify-between py-1">
                <span className="text-sm text-muted-foreground">{shortcut.description}</span>
                <div className="flex items-center gap-1">
                  {shortcut.keys.map((key, j) => (
                    <span key={j}>
                      {j > 0 && <span className="text-muted-foreground/50 text-xs mx-0.5">+</span>}
                      <kbd className="inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground min-w-[24px]">
                        {key}
                      </kbd>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-5 py-2.5">
            <p className="text-2xs text-muted-foreground text-center">
              macOS: ใช้ Cmd แทน Ctrl
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
