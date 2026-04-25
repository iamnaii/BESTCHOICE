import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, UserPlus, MessageSquare, Lock } from 'lucide-react';
import api from '@/lib/api';
import { useBulkActions } from '../hooks/useBulkActions';

interface Props {
  selectedIds: Set<string>;
  onClear: () => void;
}

interface StaffUser {
  id: string;
  name: string;
  role: string;
}

export default function BulkActionBar({ selectedIds, onClear }: Props) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [lineMessage, setLineMessage] = useState('');
  const [lineOpen, setLineOpen] = useState(false);
  const [lockReason, setLockReason] = useState('');
  const [lockOpen, setLockOpen] = useState(false);

  const { assign, sendLine, proposeLock } = useBulkActions(onClear);

  const { data: staffUsers = [] } = useQuery<StaffUser[]>({
    queryKey: ['staff-users'],
    queryFn: async () => {
      const { data } = await api.get('/users');
      const list = data.data || data || [];
      return Array.isArray(list) ? list : [];
    },
    enabled: assignOpen,
  });

  const ids = Array.from(selectedIds);
  const show = ids.length > 0;

  return (
    <>
      {/* Sticky bottom bar */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card/95 backdrop-blur-sm shadow-[0_-4px_20px_rgba(0,0,0,0.04)] transform transition-transform duration-200 ${
          show ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm font-medium tabular-nums leading-snug">
            เลือก <span className="text-primary">{ids.length}</span> รายการ
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setAssignOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-input hover:bg-muted transition-colors"
            >
              <UserPlus className="size-3.5" />
              มอบหมาย
            </button>
            <button
              onClick={() => setLineOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-input hover:bg-muted transition-colors"
            >
              <MessageSquare className="size-3.5" />
              ส่ง LINE
            </button>
            <button
              onClick={() => setLockOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-input hover:bg-muted transition-colors"
            >
              <Lock className="size-3.5" />
              เสนอล็อค
            </button>
            <button
              onClick={onClear}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="size-3.5" />
              ยกเลิก
            </button>
          </div>
        </div>
      </div>

      {/* Assign modal */}
      {assignOpen && (
        <InlineAssignModal
          staffUsers={staffUsers}
          pending={assign.isPending}
          onClose={() => setAssignOpen(false)}
          onConfirm={(assignedToId) => {
            assign.mutate({ contractIds: ids, assignedToId });
            setAssignOpen(false);
          }}
        />
      )}

      {/* Send LINE modal */}
      {lineOpen && (
        <InlineLineModal
          value={lineMessage}
          onChange={setLineMessage}
          pending={sendLine.isPending}
          onClose={() => {
            setLineOpen(false);
            setLineMessage('');
          }}
          onSubmit={() => {
            sendLine.mutate({ contractIds: ids, customMessage: lineMessage });
            setLineOpen(false);
            setLineMessage('');
          }}
        />
      )}

      {/* Propose lock modal */}
      {lockOpen && (
        <InlineLockModal
          value={lockReason}
          onChange={setLockReason}
          pending={proposeLock.isPending}
          onClose={() => {
            setLockOpen(false);
            setLockReason('');
          }}
          onSubmit={() => {
            proposeLock.mutate({ contractIds: ids, reason: lockReason });
            setLockOpen(false);
            setLockReason('');
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Inline mini-modal helpers — keep file self-contained
// ---------------------------------------------------------------------------

function ModalOverlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
      <div
        className="relative bg-card rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5 border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function InlineAssignModal({
  staffUsers,
  pending,
  onClose,
  onConfirm,
}: {
  staffUsers: StaffUser[];
  pending: boolean;
  onClose: () => void;
  onConfirm: (id: string) => void;
}) {
  const [picked, setPicked] = useState('');
  return (
    <ModalOverlay onClose={onClose}>
      <div className="text-sm font-semibold mb-3 leading-snug">มอบหมายผู้ติดตาม</div>
      <select
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        className="w-full px-3 py-2 border border-input rounded-lg text-sm mb-4 leading-snug"
      >
        <option value="">— เลือกพนักงาน —</option>
        {staffUsers.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.role})
          </option>
        ))}
      </select>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded-lg border border-input hover:bg-muted transition-colors"
        >
          ยกเลิก
        </button>
        <button
          onClick={() => picked && onConfirm(picked)}
          disabled={!picked || pending}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {pending ? 'กำลังมอบหมาย...' : 'มอบหมาย'}
        </button>
      </div>
    </ModalOverlay>
  );
}

function InlineLineModal({
  value,
  onChange,
  pending,
  onClose,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const valid = value.trim().length >= 10;
  return (
    <ModalOverlay onClose={onClose}>
      <div className="text-sm font-semibold mb-3 leading-snug">ส่ง LINE แบบพิมพ์เอง</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder="พิมพ์ข้อความที่จะส่งถึงลูกค้าที่เลือก..."
        className="w-full px-3 py-2 border border-input rounded-lg text-sm mb-2 resize-none leading-snug"
        autoFocus
      />
      <div className="text-xs text-muted-foreground mb-4 leading-snug">
        {value.length} ตัวอักษร (ขั้นต่ำ 10)
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded-lg border border-input hover:bg-muted transition-colors"
        >
          ยกเลิก
        </button>
        <button
          onClick={onSubmit}
          disabled={!valid || pending}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {pending ? 'กำลังส่ง...' : 'ส่ง LINE'}
        </button>
      </div>
    </ModalOverlay>
  );
}

function InlineLockModal({
  value,
  onChange,
  pending,
  onClose,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const valid = value.trim().length >= 5;
  return (
    <ModalOverlay onClose={onClose}>
      <div className="text-sm font-semibold mb-1 leading-snug">เสนอล็อคเครื่อง</div>
      <div className="text-xs text-muted-foreground mb-3 leading-snug">
        เหตุผลจะบันทึกใน audit log และ OWNER จะเห็นในแท็บ &quot;อนุมัติ&quot;
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="เช่น ลูกค้าติดต่อไม่ได้ 4 วัน โทรไป 5 ครั้งไม่รับ..."
        className="w-full px-3 py-2 border border-input rounded-lg text-sm mb-2 resize-none leading-snug"
        autoFocus
      />
      <div className="text-xs text-muted-foreground mb-4 leading-snug">
        {value.length} ตัวอักษร (ขั้นต่ำ 5)
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded-lg border border-input hover:bg-muted transition-colors"
        >
          ยกเลิก
        </button>
        <button
          onClick={onSubmit}
          disabled={!valid || pending}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
        >
          {pending ? 'กำลังเสนอ...' : 'เสนอล็อค'}
        </button>
      </div>
    </ModalOverlay>
  );
}
