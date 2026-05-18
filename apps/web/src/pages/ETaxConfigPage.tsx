import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import QueryBoundary from '@/components/QueryBoundary';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  Eye,
  EyeOff,
  Save,
  Plug,
  AlertCircle,
} from 'lucide-react';

/**
 * P2-SP5 — e-Tax Invoice configuration for OWNER.
 *
 * Wraps the existing `/integrations/e-tax/config` endpoints so the owner
 * can set submit mode + cert path/password + RD credentials in one
 * focused screen instead of the generic Integration Hub.
 *
 * "ทดสอบการเชื่อมต่อ" runs `POST /e-tax-xml/check-config` which loads
 * the PFX (decrypts via stored password) + pings the RD endpoint.
 */

interface ETaxConfig {
  submitMode: string;
  certPath: string;
  certPassword: string;
  rdEndpoint: string;
  rdUsername: string;
  rdPassword: string;
}

interface CheckConfigResult {
  submitMode: 'disabled' | 'enabled';
  certConfigured: boolean;
  certError?: string;
  rdReachable: boolean;
  rdDetail: string;
}

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden bg-background text-foreground leading-snug';

export function ETaxConfigPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<ETaxConfig | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const configQuery = useQuery<{ config: ETaxConfig }>({
    queryKey: ['integration-config', 'e-tax'],
    queryFn: async () => {
      const res = await api.get('/integrations/e-tax/config');
      return res.data;
    },
  });

  // Hydrate form when query resolves
  if (configQuery.data && form === null) {
    setForm({
      submitMode: configQuery.data.config?.submitMode ?? 'disabled',
      certPath: configQuery.data.config?.certPath ?? '',
      certPassword: configQuery.data.config?.certPassword ?? '',
      rdEndpoint:
        configQuery.data.config?.rdEndpoint ??
        'https://etax.rd.go.th/etax_staging/etaxws',
      rdUsername: configQuery.data.config?.rdUsername ?? '',
      rdPassword: configQuery.data.config?.rdPassword ?? '',
    });
  }

  const saveMutation = useMutation({
    mutationFn: async (data: ETaxConfig) => {
      const res = await api.put('/integrations/e-tax/config', data);
      return res.data;
    },
    onSuccess: () => {
      toast.success('บันทึกการตั้งค่า e-Tax แล้ว');
      qc.invalidateQueries({ queryKey: ['integration-config', 'e-tax'] });
    },
    onError: (e: Error) => {
      toast.error(e.message ?? 'บันทึกล้มเหลว');
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/e-tax-xml/check-config');
      return res.data as CheckConfigResult;
    },
    onError: (e: Error) => {
      toast.error(e.message ?? 'ทดสอบล้มเหลว');
    },
  });

  const handleSave = () => {
    if (!form) return;
    saveMutation.mutate(form);
  };

  const toggleSecret = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      <PageHeader
        title="ตั้งค่า e-Tax Invoice (สรรพากร)"
        subtitle="ขมธอ.21-2562 + ป.รัษฎากร ม.86/4 — ปรับเฉพาะ OWNER"
        icon={<ShieldCheck className="size-5" aria-hidden />}
      />

      <div
        data-testid="etax-config-banner"
        className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 mb-4"
      >
        <AlertCircle className="size-4 text-warning mt-0.5 shrink-0" aria-hidden />
        <div className="text-sm text-foreground leading-snug">
          <p className="font-medium mb-1">
            โหมด disabled = ระบบสร้าง XML ได้ แต่ไม่ส่งให้สรรพากร
          </p>
          <p className="text-muted-foreground">
            ก่อนเปิด <code className="px-1 bg-muted rounded">enabled</code> ต้องตั้งค่า:
            (1) ไฟล์ใบรับรอง (.p12/.pfx) จาก CA ที่ RD อนุมัติ (NDID/ThaiCERT/INET),
            (2) Username + Password ของ RD web service.
            กดปุ่ม &quot;ทดสอบการเชื่อมต่อ&quot; เพื่อยืนยันก่อนเปิดส่งจริง.
          </p>
        </div>
      </div>

      <QueryBoundary
        isLoading={configQuery.isLoading}
        isError={configQuery.isError}
        error={configQuery.error}
        onRetry={configQuery.refetch}
      >
        {form && (
          <Card data-testid="etax-config-form">
            <CardHeader>
              <h3 className="text-sm font-semibold text-foreground leading-snug">
                การตั้งค่า e-Tax
              </h3>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4">
                {/* Submit Mode */}
                <div>
                  <label className="text-xs text-muted-foreground leading-snug mb-1 block">
                    โหมดส่ง RD
                  </label>
                  <select
                    value={form.submitMode}
                    onChange={(e) =>
                      setForm({ ...form, submitMode: e.target.value })
                    }
                    className={inputClass}
                    data-testid="etax-mode-select"
                  >
                    <option value="disabled">
                      disabled — สร้าง XML เท่านั้น (default)
                    </option>
                    <option value="enabled">
                      enabled — ส่งให้สรรพากร (ต้องตั้งค่าครบ)
                    </option>
                  </select>
                </div>

                {/* Cert Path */}
                <div>
                  <label className="text-xs text-muted-foreground leading-snug mb-1 block">
                    Path ไฟล์ใบรับรอง (.p12/.pfx)
                  </label>
                  <input
                    type="text"
                    value={form.certPath}
                    onChange={(e) => setForm({ ...form, certPath: e.target.value })}
                    placeholder="/secrets/etax-cert.pfx"
                    className={inputClass}
                  />
                </div>

                {/* Cert Password */}
                <div>
                  <label className="text-xs text-muted-foreground leading-snug mb-1 block">
                    รหัสผ่านใบรับรอง
                  </label>
                  <div className="flex gap-2">
                    <input
                      type={showSecrets.certPassword ? 'text' : 'password'}
                      value={form.certPassword}
                      onChange={(e) =>
                        setForm({ ...form, certPassword: e.target.value })
                      }
                      placeholder="passphrase"
                      className={inputClass}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => toggleSecret('certPassword')}
                      aria-label="แสดง/ซ่อน รหัสผ่าน"
                    >
                      {showSecrets.certPassword ? (
                        <EyeOff className="size-4" aria-hidden />
                      ) : (
                        <Eye className="size-4" aria-hidden />
                      )}
                    </Button>
                  </div>
                </div>

                {/* RD Endpoint */}
                <div>
                  <label className="text-xs text-muted-foreground leading-snug mb-1 block">
                    URL ของ RD web service
                  </label>
                  <input
                    type="url"
                    value={form.rdEndpoint}
                    onChange={(e) =>
                      setForm({ ...form, rdEndpoint: e.target.value })
                    }
                    placeholder="https://etax.rd.go.th/etax_staging/etaxws"
                    className={inputClass}
                  />
                  <p className="text-xs text-muted-foreground mt-1 leading-snug">
                    Staging (default) / Production:
                    <code className="px-1 ml-1 bg-muted rounded">
                      https://etax.rd.go.th/etax_v2/etaxws
                    </code>
                  </p>
                </div>

                {/* RD Username */}
                <div>
                  <label className="text-xs text-muted-foreground leading-snug mb-1 block">
                    Username (RD)
                  </label>
                  <input
                    type="text"
                    value={form.rdUsername}
                    onChange={(e) =>
                      setForm({ ...form, rdUsername: e.target.value })
                    }
                    placeholder="ลงทะเบียนกับ RD ได้จาก etax.rd.go.th"
                    className={inputClass}
                  />
                </div>

                {/* RD Password */}
                <div>
                  <label className="text-xs text-muted-foreground leading-snug mb-1 block">
                    Password (RD)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type={showSecrets.rdPassword ? 'text' : 'password'}
                      value={form.rdPassword}
                      onChange={(e) =>
                        setForm({ ...form, rdPassword: e.target.value })
                      }
                      placeholder="passphrase"
                      className={inputClass}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => toggleSecret('rdPassword')}
                      aria-label="แสดง/ซ่อน รหัสผ่าน"
                    >
                      {showSecrets.rdPassword ? (
                        <EyeOff className="size-4" aria-hidden />
                      ) : (
                        <Eye className="size-4" aria-hidden />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3 justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending}
                  data-testid="etax-test-btn"
                >
                  <Plug className="size-4 mr-2" aria-hidden />
                  {testMutation.isPending ? 'กำลังทดสอบ…' : 'ทดสอบการเชื่อมต่อ'}
                </Button>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  data-testid="etax-save-btn"
                >
                  <Save className="size-4 mr-2" aria-hidden />
                  {saveMutation.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </QueryBoundary>

      {/* Test result */}
      {testMutation.data && (
        <Card className="mt-4" data-testid="etax-test-result">
          <CardHeader>
            <h3 className="text-sm font-semibold text-foreground leading-snug">
              ผลทดสอบการเชื่อมต่อ
            </h3>
          </CardHeader>
          <CardContent>
            <ul className="text-sm space-y-2">
              <li className="flex items-start gap-2">
                {testMutation.data.submitMode === 'enabled' ? (
                  <ShieldCheck className="size-4 text-success mt-0.5 shrink-0" aria-hidden />
                ) : (
                  <ShieldOff className="size-4 text-muted-foreground mt-0.5 shrink-0" aria-hidden />
                )}
                <span className="leading-snug">
                  โหมด: <strong>{testMutation.data.submitMode}</strong>
                </span>
              </li>
              <li className="flex items-start gap-2">
                {testMutation.data.certConfigured ? (
                  <ShieldCheck className="size-4 text-success mt-0.5 shrink-0" aria-hidden />
                ) : (
                  <ShieldAlert className="size-4 text-destructive mt-0.5 shrink-0" aria-hidden />
                )}
                <span className="leading-snug">
                  ใบรับรอง:{' '}
                  {testMutation.data.certConfigured
                    ? 'โหลด PFX สำเร็จ'
                    : (testMutation.data.certError ?? 'ไม่ได้ตั้งค่า')}
                </span>
              </li>
              <li className="flex items-start gap-2">
                {testMutation.data.rdReachable ? (
                  <ShieldCheck className="size-4 text-success mt-0.5 shrink-0" aria-hidden />
                ) : (
                  <ShieldAlert className="size-4 text-destructive mt-0.5 shrink-0" aria-hidden />
                )}
                <span className="leading-snug">
                  RD endpoint: {testMutation.data.rdDetail}
                </span>
              </li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default ETaxConfigPage;
