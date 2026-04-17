import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Webhook, Plus, Trash2, Send, CheckCircle, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, activeStatusMap } from '@/lib/status-badges';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WebhookSubscription {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
  createdBy: { id: string; name: string };
  lastDelivery: { success: boolean; createdAt: string; statusCode: number | null } | null;
}

interface CreateWebhookForm {
  name: string;
  url: string;
  secret: string;
  events: string[];
}

const SUPPORTED_EVENTS = [
  { value: 'payment.received', label: 'Payment Received — รับชำระค่างวด' },
  { value: 'payment.overdue', label: 'Payment Overdue — ค้างชำระ' },
  { value: 'contract.activated', label: 'Contract Activated — เปิดสัญญา' },
  { value: 'contract.completed', label: 'Contract Completed — ปิดสัญญา' },
  { value: 'contract.defaulted', label: 'Contract Defaulted — สัญญาผิดนัด' },
  { value: 'trade_in.completed', label: 'Trade-in Completed — รับซื้อมือสอง' },
  { value: 'customer.created', label: 'Customer Created — ลูกค้าใหม่' },
];

// ─── Form Component ───────────────────────────────────────────────────────────

function AddWebhookForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState<CreateWebhookForm>({
    name: '',
    url: '',
    secret: '',
    events: [],
  });

  const mutation = useMutation({
    mutationFn: (data: CreateWebhookForm) => api.post('/webhooks', data),
    onSuccess: () => {
      toast.success('ลงทะเบียน webhook สำเร็จ');
      onSuccess();
    },
    onError: (err: unknown) => {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast.error(message || 'เกิดข้อผิดพลาด');
    },
  });

  const toggleEvent = (value: string) => {
    setForm((f) => ({
      ...f,
      events: f.events.includes(value)
        ? f.events.filter((e) => e !== value)
        : [...f.events, value],
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.url.trim() || !form.secret.trim() || form.events.length === 0) {
      toast.error('กรุณากรอกข้อมูลให้ครบ และเลือกอย่างน้อย 1 event');
      return;
    }
    mutation.mutate(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            ชื่อ <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            placeholder="เช่น Partner XYZ Integration"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            URL <span className="text-destructive">*</span>
          </label>
          <input
            type="url"
            placeholder="https://partner.com/webhook"
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
            required
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          Secret Key <span className="text-destructive">*</span>
          <span className="text-xs text-muted-foreground ml-1">(ใช้สำหรับ HMAC-SHA256 signature ใน header X-Webhook-Signature)</span>
        </label>
        <input
          type="text"
          placeholder="your-secret-key"
          value={form.secret}
          onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
          className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-hidden focus:ring-2 focus:ring-ring"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          Events <span className="text-destructive">*</span>
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {SUPPORTED_EVENTS.map((ev) => (
            <label key={ev.value} className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.events.includes(ev.value)}
                onChange={() => toggleEvent(ev.value)}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-mono text-primary text-xs">{ev.value}</span>
                <br />
                <span className="text-muted-foreground text-xs">{ev.label}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {mutation.isPending ? 'กำลังบันทึก...' : 'ลงทะเบียน Webhook'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}

// ─── Webhook Row ──────────────────────────────────────────────────────────────

function WebhookRow({
  sub,
  onDelete,
}: {
  sub: WebhookSubscription;
  onDelete: (id: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const testMutation = useMutation({
    mutationFn: () => api.post(`/webhooks/test/${sub.id}`),
    onSuccess: (res) => {
      const d = res.data as { success: boolean; statusCode: number | null };
      if (d.success) {
        toast.success(`Test event ส่งสำเร็จ (HTTP ${d.statusCode})`);
      } else {
        toast.error(`Test event ล้มเหลว (HTTP ${d.statusCode ?? 'timeout'})`);
      }
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
    onError: () => toast.error('เกิดข้อผิดพลาดในการส่ง test event'),
  });

  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 p-4 bg-card">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-muted-foreground hover:text-muted-foreground"
          aria-label={expanded ? 'ซ่อน' : 'แสดงรายละเอียด'}
        >
          <ChevronIcon className="w-4 h-4" aria-hidden="true" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{sub.name}</span>
            {(() => {
              const cfg = getStatusBadgeProps(sub.isActive ? 'active' : 'inactive', activeStatusMap);
              return (
                <Badge variant={cfg.variant} appearance={cfg.appearance} className="text-xs">
                  {sub.isActive ? 'Active' : 'Inactive'}
                </Badge>
              );
            })()}
            {sub.lastDelivery && (
              <Badge
                variant={sub.lastDelivery.success ? 'success' : 'destructive'}
                appearance="light"
                className="inline-flex items-center gap-1 text-xs"
              >
                {sub.lastDelivery.success ? (
                  <CheckCircle className="w-3 h-3" aria-hidden="true" />
                ) : (
                  <XCircle className="w-3 h-3" aria-hidden="true" />
                )}
                {sub.lastDelivery.success ? 'OK' : 'Failed'}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">{sub.url}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md hover:bg-primary/10 hover:border-primary/30 text-primary transition-colors disabled:opacity-50"
            aria-label="ส่ง test event"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            Test
          </button>
          <button
            onClick={() => onDelete(sub.id, sub.name)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md hover:bg-destructive/10 hover:border-destructive/30 text-destructive transition-colors"
            aria-label="ลบ webhook"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            ลบ
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t bg-muted p-4 space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Events ที่ subscribe</p>
            <div className="flex flex-wrap gap-1.5">
              {sub.events.map((ev) => (
                <span
                  key={ev}
                  className="inline-block font-mono text-xs bg-info/20 text-info px-2 py-0.5 rounded"
                >
                  {ev}
                </span>
              ))}
            </div>
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>สร้างโดย: {sub.createdBy.name}</p>
            <p>สร้างเมื่อ: {new Date(sub.createdAt).toLocaleString('th-TH')}</p>
            {sub.lastDelivery && (
              <p>
                การส่งล่าสุด:{' '}
                {new Date(sub.lastDelivery.createdAt).toLocaleString('th-TH')} —{' '}
                HTTP {sub.lastDelivery.statusCode ?? 'timeout'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WebhooksPage() {
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery<WebhookSubscription[]>({
    queryKey: ['webhooks'],
    queryFn: async () => {
      const { data } = await api.get<WebhookSubscription[]>('/webhooks');
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/webhooks/${id}`),
    onSuccess: () => {
      toast.success('ลบ webhook สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      setDeleteTarget(null);
    },
    onError: () => toast.error('เกิดข้อผิดพลาด'),
  });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="Outbound Webhooks"
        subtitle="ลงทะเบียน webhook สำหรับส่งข้อมูลไปยัง external partners อัตโนมัติ"
        icon={<Webhook className="w-6 h-6" aria-hidden="true" />}
        action={
          !showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              เพิ่ม Webhook
            </button>
          ) : undefined
        }
      />

      {showForm && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-foreground">ลงทะเบียน Webhook ใหม่</h2>
          </CardHeader>
          <CardContent>
            <AddWebhookForm
              onClose={() => setShowForm(false)}
              onSuccess={() => {
                setShowForm(false);
                queryClient.invalidateQueries({ queryKey: ['webhooks'] });
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Info box */}
      <div className="rounded-lg border border-info/20 bg-info/10 p-4 text-sm text-info">
        <p className="font-medium mb-1">วิธีตรวจสอบ Signature</p>
        <p className="text-xs text-info">
          ทุก request จะมี header{' '}
          <code className="font-mono bg-info/20 px-1 rounded">X-Webhook-Signature: sha256=&lt;hmac&gt;</code>{' '}
          — คำนวณด้วย HMAC-SHA256 ของ request body โดยใช้ secret key ที่ตั้งค่าไว้
        </p>
      </div>

      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลด webhooks ได้"
      >
        {data && data.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Webhook className="w-10 h-10 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
            <p>ยังไม่มี webhook subscription</p>
            <p className="text-sm mt-1">คลิก "เพิ่ม Webhook" เพื่อเริ่มต้น</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(data || []).map((sub) => (
              <WebhookRow
                key={sub.id}
                sub={sub}
                onDelete={(id, name) => setDeleteTarget({ id, name })}
              />
            ))}
          </div>
        )}
      </QueryBoundary>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="ลบ Webhook Subscription"
        description={`ต้องการลบ "${deleteTarget?.name}" ใช่หรือไม่? การดำเนินการนี้ไม่สามารถยกเลิกได้`}
        confirmLabel="ลบ"
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
