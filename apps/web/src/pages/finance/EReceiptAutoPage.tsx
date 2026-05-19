/**
 * EReceiptAutoPage — auto e-receipt delivery config (SP2-Task9)
 *
 * Reads/writes SystemConfig key `e_receipt_auto` as a JSON-encoded object.
 * Uses existing PATCH /settings endpoint (D1.1.2.x pattern).
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { FileText, Save } from 'lucide-react';
import { toast } from 'sonner';

const CONFIG_KEY = 'e_receipt_auto';

interface EReceiptConfig {
  enabled: boolean;
  deliveryChannel: 'LINE' | 'EMAIL' | 'BOTH';
  template: 'STANDARD' | 'SIMPLE';
  signerName: string;
}

const DEFAULT_CONFIG: EReceiptConfig = {
  enabled: false,
  deliveryChannel: 'LINE',
  template: 'STANDARD',
  signerName: '',
};

interface SystemConfigRow {
  key: string;
  value: string;
}

function parseConfig(rows: SystemConfigRow[]): EReceiptConfig {
  const row = rows.find((r) => r.key === CONFIG_KEY);
  if (!row) return DEFAULT_CONFIG;
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(row.value) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export default function EReceiptAutoPage() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<EReceiptConfig | null>(null);

  const query = useQuery({
    queryKey: ['settings', 'e-receipt-auto'],
    queryFn: () => api.get<SystemConfigRow[]>('/settings').then((r) => r.data),
  });

  // Sync draft from loaded data (only once on first load)
  useEffect(() => {
    if (query.data && !draft) {
      setDraft(parseConfig(query.data));
    }
  }, [query.data, draft]);

  const saveMutation = useMutation({
    mutationFn: (cfg: EReceiptConfig) =>
      api.patch('/settings', {
        items: [{ key: CONFIG_KEY, value: JSON.stringify(cfg) }],
      }),
    onSuccess: () => {
      toast.success('บันทึกการตั้งค่าสำเร็จ');
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: () => toast.error('บันทึกล้มเหลว กรุณาลองใหม่'),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="ใบเสร็จอิเล็กทรอนิกส์อัตโนมัติ"
        icon={<FileText className="size-5" />}
        subtitle="ตั้งค่าการส่งใบเสร็จอัตโนมัติเมื่อบันทึกรับชำระค่างวด"
      />
      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={query.refetch}
      >
        {draft && (
          <Card className="max-w-lg">
            <CardHeader>
              <h3 className="font-semibold text-foreground">ตั้งค่าการส่งใบเสร็จ</h3>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Enabled toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">เปิดใช้งานอัตโนมัติ</div>
                  <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                    ส่งใบเสร็จทันทีเมื่อบันทึกการรับชำระ
                  </div>
                </div>
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
                />
              </div>

              {/* Delivery channel */}
              <div>
                <label className="text-sm font-medium block mb-2">ช่องทางการส่ง</label>
                <div className="flex gap-2">
                  {(['LINE', 'EMAIL', 'BOTH'] as const).map((c) => (
                    <Button
                      key={c}
                      type="button"
                      variant={draft.deliveryChannel === c ? 'primary' : 'outline'}
                      size="sm"
                      onClick={() => setDraft({ ...draft, deliveryChannel: c })}
                    >
                      {c === 'BOTH' ? 'LINE + Email' : c}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Template */}
              <div>
                <label className="text-sm font-medium block mb-2">รูปแบบ Template</label>
                <div className="flex gap-2">
                  {(['STANDARD', 'SIMPLE'] as const).map((t) => (
                    <Button
                      key={t}
                      type="button"
                      variant={draft.template === t ? 'primary' : 'outline'}
                      size="sm"
                      onClick={() => setDraft({ ...draft, template: t })}
                    >
                      {t === 'STANDARD' ? 'มาตรฐาน (เต็มรูปแบบ)' : 'แบบย่อ (สั้น)'}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Signer name */}
              <div>
                <label className="text-sm font-medium block mb-2" htmlFor="signer-name">
                  ชื่อผู้เซ็นใบเสร็จ
                </label>
                <input
                  id="signer-name"
                  type="text"
                  className="w-full border border-input rounded-lg px-3 py-2 bg-card text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 outline-none text-sm"
                  value={draft.signerName}
                  onChange={(e) => setDraft({ ...draft, signerName: e.target.value })}
                  placeholder="ชื่อ-นามสกุล ผู้เซ็น"
                />
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => draft && saveMutation.mutate(draft)}
                  disabled={saveMutation.isPending}
                >
                  <Save className="size-4 mr-1.5" />
                  บันทึก
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </QueryBoundary>
    </div>
  );
}
