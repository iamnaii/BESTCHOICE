import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Play,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';

/**
 * FacebookAppReviewPanel — Admin UI for running each Graph API permission
 * test required by Facebook App Review. Renders 9 test actions, each a
 * single-click trigger to the corresponding /facebook/app-review/* endpoint.
 *
 * Results are stored per-test and remain visible so the owner can confirm
 * every permission was exercised before submitting App Review.
 */

interface TestResult {
  success: boolean;
  message: string;
  data?: unknown;
  at: Date;
}

type TestKey =
  | 'pages_show_list'
  | 'pages_manage_ads'
  | 'lead_forms_list'
  | 'ads_insights'
  | 'standard_message'
  | 'subscribe_webhooks'
  | 'create_campaign'
  | 'update_campaign_status'
  | 'lead_form_leads'
  | 'live_video'
  | 'publish_video';

interface TestCase {
  key: TestKey;
  permission: string;
  title: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PATCH';
  group: 'read' | 'write';
  inputs?: InputField[];
}

interface InputField {
  key: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  type?: 'text' | 'number';
}

const TESTS: TestCase[] = [
  {
    key: 'pages_show_list',
    permission: 'pages_show_list',
    title: 'ดึงรายการ Pages ที่จัดการ',
    endpoint: '/facebook/app-review/pages',
    method: 'GET',
    group: 'read',
  },
  {
    key: 'pages_manage_ads',
    permission: 'pages_manage_ads',
    title: 'ดูโพสต์ที่ boost ได้',
    endpoint: '/facebook/app-review/promotable-posts',
    method: 'GET',
    group: 'read',
  },
  {
    key: 'lead_forms_list',
    permission: 'leads_retrieval (list)',
    title: 'ดูรายการ Lead Forms ของเพจ',
    endpoint: '/facebook/app-review/lead-forms',
    method: 'GET',
    group: 'read',
  },
  {
    key: 'ads_insights',
    permission: 'ads_read',
    title: 'ดู Insights ของ Ad Account (30 วัน)',
    endpoint: '/facebook/app-review/insights',
    method: 'GET',
    group: 'read',
  },
  {
    key: 'standard_message',
    permission: 'pages_messaging',
    title: 'ส่งข้อความ Messenger ปกติ (24hr window)',
    endpoint: '/facebook/app-review/messenger-message',
    method: 'POST',
    group: 'write',
    inputs: [
      { key: 'recipientPsid', label: 'PSID ผู้รับ', placeholder: '1234567890' },
      {
        key: 'text',
        label: 'ข้อความตอบกลับ',
        defaultValue: 'สวัสดีครับ ขอบคุณที่ติดต่อ BESTCHOICE',
      },
    ],
  },
  {
    key: 'subscribe_webhooks',
    permission: 'pages_manage_metadata',
    title: 'Subscribe Page Webhooks',
    endpoint: '/facebook/app-review/subscribe-webhooks',
    method: 'POST',
    group: 'write',
    inputs: [
      {
        key: 'fields',
        label: 'Subscribed fields (comma-separated)',
        defaultValue: 'messages,messaging_postbacks,message_deliveries,message_reads',
      },
    ],
  },
  {
    key: 'create_campaign',
    permission: 'ads_management + Standard Access',
    title: 'สร้าง Ad Campaign (PAUSED)',
    endpoint: '/facebook/app-review/campaigns',
    method: 'POST',
    group: 'write',
    inputs: [
      { key: 'name', label: 'ชื่อ Campaign', defaultValue: 'App Review Test Campaign' },
      { key: 'dailyBudget', label: 'งบรายวัน (บาท)', type: 'number', defaultValue: '20' },
    ],
  },
  {
    key: 'update_campaign_status',
    permission: 'ads_management',
    title: 'อัปเดตสถานะ Campaign',
    endpoint: '/facebook/app-review/campaigns/:id/status',
    method: 'PATCH',
    group: 'write',
    inputs: [
      { key: 'id', label: 'Campaign ID', placeholder: '120xxx...' },
      { key: 'status', label: 'Status (ACTIVE/PAUSED)', defaultValue: 'PAUSED' },
    ],
  },
  {
    key: 'lead_form_leads',
    permission: 'leads_retrieval (fetch)',
    title: 'ดึง Leads จาก Form',
    endpoint: '/facebook/app-review/lead-forms/:id/leads',
    method: 'GET',
    group: 'write',
    inputs: [{ key: 'id', label: 'Form ID', placeholder: '1234567890' }],
  },
  {
    key: 'live_video',
    permission: 'Live Video API',
    title: 'สร้าง Live Video (SCHEDULED)',
    endpoint: '/facebook/app-review/live-videos',
    method: 'POST',
    group: 'write',
    inputs: [
      { key: 'title', label: 'หัวข้อไลฟ์', defaultValue: 'BESTCHOICE Live Test' },
      {
        key: 'plannedStartTime',
        label: 'เวลาเริ่ม (unix timestamp)',
        type: 'number',
        defaultValue: String(Math.floor(Date.now() / 1000) + 86400),
      },
    ],
  },
  {
    key: 'publish_video',
    permission: 'publish_video',
    title: 'อัปโหลด Video ขึ้นเพจ',
    endpoint: '/facebook/app-review/videos',
    method: 'POST',
    group: 'write',
    inputs: [
      {
        key: 'fileUrl',
        label: 'URL วิดีโอ (public .mp4)',
        placeholder: 'https://example.com/video.mp4',
      },
      { key: 'title', label: 'หัวข้อ', defaultValue: 'BESTCHOICE sample' },
    ],
  },
];

function TestRow({ test }: { test: TestCase }) {
  const [expanded, setExpanded] = useState(test.group === 'read');
  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries((test.inputs ?? []).map((f) => [f.key, f.defaultValue ?? ''])),
  );
  const [result, setResult] = useState<TestResult | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      let url = test.endpoint;
      let payload: Record<string, unknown> | undefined;

      if (test.inputs) {
        const vals = { ...inputs };
        if (url.includes(':id')) {
          url = url.replace(':id', encodeURIComponent(vals.id ?? ''));
          delete vals.id;
        }
        if (test.method !== 'GET' && Object.keys(vals).length > 0) {
          payload = {};
          for (const [k, v] of Object.entries(vals)) {
            const field = test.inputs.find((f) => f.key === k);
            payload[k] = field?.type === 'number' ? Number(v) : v;
          }
        }
      }

      if (test.method === 'GET') {
        return api.get(url).then((r) => r.data);
      }
      if (test.method === 'PATCH') {
        return api.patch(url, payload).then((r) => r.data);
      }
      return api.post(url, payload).then((r) => r.data);
    },
    onSuccess: (data) => {
      const summary = extractSummary(data);
      setResult({ success: true, message: summary, data, at: new Date() });
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        'เรียก API ไม่สำเร็จ';
      setResult({ success: false, message: msg, at: new Date() });
    },
  });

  const canRun =
    !test.inputs || test.inputs.every((f) => (inputs[f.key] ?? '').trim().length > 0);

  return (
    <div className="rounded-lg border border-border bg-background">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-accent/50 rounded-lg"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {expanded ? (
            <ChevronDown className="size-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate">{test.title}</p>
            <p className="text-2xs font-mono text-muted-foreground truncate">
              {test.permission}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {result?.success === true && (
            <Badge variant="success" appearance="light" size="sm">
              <CheckCircle2 className="size-3" /> สำเร็จ
            </Badge>
          )}
          {result?.success === false && (
            <Badge variant="destructive" appearance="light" size="sm">
              <XCircle className="size-3" /> ล้มเหลว
            </Badge>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          <p className="text-xs text-muted-foreground font-mono">
            {test.method} {test.endpoint}
          </p>

          {test.inputs && (
            <div className="space-y-2">
              {test.inputs.map((field) => (
                <div key={field.key} className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    {field.label}
                  </label>
                  <Input
                    type={field.type ?? 'text'}
                    value={inputs[field.key] ?? ''}
                    onChange={(e) =>
                      setInputs((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    placeholder={field.placeholder}
                    className="h-8 text-xs"
                  />
                </div>
              ))}
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={!canRun || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                กำลังยิง...
              </>
            ) : (
              <>
                <Play className="size-3" />
                ยิง API
              </>
            )}
          </Button>

          {result && <ResultBlock result={result} />}
        </div>
      )}
    </div>
  );
}

function ResultBlock({ result }: { result: TestResult }) {
  const [showData, setShowData] = useState(false);
  const hasData = result.data !== undefined && result.data !== null;
  const json = hasData ? JSON.stringify(result.data, null, 2) : '';

  const copyJson = async () => {
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      /* ignore — older browsers */
    }
  };

  return (
    <div
      className={cn(
        'rounded-md text-xs border',
        result.success
          ? 'bg-success/10 text-success border-success/20'
          : 'bg-destructive/10 text-destructive border-destructive/20',
      )}
    >
      <div className="flex items-start gap-2 p-2">
        {result.success ? (
          <CheckCircle2 className="size-3 shrink-0 mt-0.5" />
        ) : (
          <XCircle className="size-3 shrink-0 mt-0.5" />
        )}
        <div className="min-w-0 flex-1">
          <p className="leading-snug break-words">{result.message}</p>
          <p className="text-2xs text-muted-foreground mt-1">
            {result.at.toLocaleTimeString('th-TH')}
          </p>
        </div>
      </div>

      {hasData && (
        <div className="border-t border-current/10 px-2 py-1.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowData((v) => !v)}
            className="text-2xs underline hover:no-underline"
          >
            {showData ? 'ซ่อนข้อมูล' : 'ดูข้อมูล (JSON)'}
          </button>
          {showData && (
            <button
              type="button"
              onClick={copyJson}
              className="text-2xs underline hover:no-underline ml-auto"
            >
              คัดลอก
            </button>
          )}
        </div>
      )}

      {showData && hasData && (
        <pre className="text-2xs font-mono px-2 pb-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-foreground/80">
          {json}
        </pre>
      )}
    </div>
  );
}

function extractSummary(data: unknown): string {
  if (!data || typeof data !== 'object') return 'สำเร็จ';
  const d = data as Record<string, unknown>;
  if ('id' in d) return `สำเร็จ (id: ${String(d.id)})`;
  if (Array.isArray((d as { data?: unknown }).data)) {
    const arr = (d as { data: unknown[] }).data;
    return `สำเร็จ (ได้ข้อมูล ${arr.length} รายการ)`;
  }
  if (d.message_id) return `สำเร็จ (message_id: ${String(d.message_id)})`;
  return 'สำเร็จ';
}

export function FacebookAppReviewPanel() {
  const readTests = TESTS.filter((t) => t.group === 'read');
  const writeTests = TESTS.filter((t) => t.group === 'write');

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          ทดสอบ Permissions (Facebook App Review)
        </h3>
        <p className="text-xs text-muted-foreground leading-snug mt-1">
          ยิง API แต่ละ endpoint เพื่อให้ FB App Dashboard บันทึกว่าทุก permission ถูกทดสอบแล้ว
          — ผลขึ้น dashboard ภายใน 24 ชม. และมีอายุ 30 วัน ต้องยิงจาก Live Mode
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          อ่านข้อมูล (ไม่ต้องกรอกเพิ่ม)
        </p>
        {readTests.map((t) => (
          <TestRow key={t.key} test={t} />
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          ต้องกรอกข้อมูลทดสอบ
        </p>
        {writeTests.map((t) => (
          <TestRow key={t.key} test={t} />
        ))}
      </div>

      <a
        href="/docs/guides/FACEBOOK-APP-REVIEW.md"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        <ExternalLink className="size-3" />
        เปิด runbook ฉบับเต็ม
      </a>
    </div>
  );
}
