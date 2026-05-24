import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';
import api from '@/lib/api';

interface CannedResponse {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  category?: string | null;
  sortOrder?: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (content: string) => void;
  roomId: string | null;
}

export default function MessageTemplatePicker({ isOpen, onClose, onInsert, roomId }: Props) {
  // NOTE: roomId is reserved for future use (Task 5: preview pane will fetch
  // /staff-chat/canned-responses/:id/preview?roomId=... to expand variables).
  void roomId;
  void onInsert;

  const [selectedId] = useState<string | null>(null);

  const { data: templates = [], isError } = useQuery<CannedResponse[]>({
    queryKey: ['canned-responses-picker'],
    queryFn: () => api.get('/staff-chat/canned-responses').then((r: any) => r.data),
    enabled: isOpen,
    refetchOnWindowFocus: false,
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl p-0 gap-0" style={{ height: 600 }}>
        <DialogHeader className="px-5 py-3.5 border-b border-border">
          <DialogTitle className="text-base font-semibold leading-snug">
            เลือกข้อความสำเร็จรูป
          </DialogTitle>
          <DialogDescription className="text-xs leading-snug">
            เลือก template เพื่อใส่ในช่องตอบ — ตัวแปร เช่น {'{customerName}'} จะถูกแทนค่าอัตโนมัติ
          </DialogDescription>
        </DialogHeader>

        {/* TODO(Task 4-6): replace placeholder body with tree pane (Task 4) +
            preview pane (Task 5) + search input (Task 6). */}
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {isError ? 'โหลด template ไม่สำเร็จ' : `${templates.length} templates loaded`}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/30">
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button disabled={!selectedId}>
            <Check className="w-4 h-4 mr-1.5" />
            ใส่ข้อความ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
