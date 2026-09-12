import { useState, type ReactNode } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Button } from './button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from './sheet';
import { SlidersHorizontal } from 'lucide-react';

/** One filter tree at a time; search stays reachable while mobile filters live in a sheet. */
export default function ResponsiveFilterPanel({ search, children }: { search: ReactNode; children: ReactNode }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  return <Sheet open={open} onOpenChange={setOpen}><div className="min-w-0 rounded-xl border border-border/50 bg-card p-4 mb-5 space-y-3">
    <div className="flex min-w-0 items-center gap-2">
      <div className="min-w-0 flex-1">{search}</div>
      {mobile && <SheetTrigger asChild><Button variant="outline" aria-label="เปิดตัวกรอง"><SlidersHorizontal className="size-4" />ตัวกรอง</Button></SheetTrigger>}
    </div>
    {mobile ? <>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader><SheetTitle>ตัวกรองรายการ</SheetTitle><SheetDescription>รายการปรับตามเงื่อนไขที่เลือก</SheetDescription></SheetHeader>
        <div className="min-w-0 space-y-4">{children}</div>
        <Button onClick={() => setOpen(false)}>ดูรายการ</Button>
      </SheetContent>
    </> : children}
  </div></Sheet>;
}
