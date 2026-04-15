import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  Plug,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  MessageSquare,
  CreditCard,
  Lock,
  BookOpen,
  BarChart3,
  Smartphone,
  Settings2,
} from 'lucide-react';

/* ── Types ───────────────────────────────────────────── */

interface Integration {
  key: string;
  name: string;
  description: string;
  configured: boolean;
  icon?: string;
}

interface RegistryField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean';
  required: boolean;
  placeholder?: string;
  description?: string;
}

interface RegistryEntry {
  key: string;
  name: string;
  description: string;
  fields: RegistryField[];
}

interface Registry {
  [key: string]: RegistryEntry;
}

interface IntegrationConfig {
  [field: string]: string;
}

/* ── Icon map ────────────────────────────────────────── */

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  chatcone: MessageSquare,
  paysolutions: CreditCard,
  peak: BookOpen,
  mdm: Lock,
  line: Zap,
  sms: Smartphone,
  analytics: BarChart3,
  default: Settings2,
};

function getIntegrationIcon(key: string): React.ComponentType<{ className?: string }> {
  const lower = key.toLowerCase();
  for (const [k, Icon] of Object.entries(ICON_MAP)) {
    if (lower.includes(k)) return Icon;
  }
  return ICON_MAP.default;
}

/* ── Integration Card ────────────────────────────────── */

function IntegrationCard({
  integration,
  onClick,
}: {
  integration: Integration;
  onClick: () => void;
}) {
  const Icon = getIntegrationIcon(integration.key);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left p-5 rounded-xl border bg-card shadow-xs transition-all',
        'hover:shadow-md hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-lg bg-muted shrink-0">
            <Icon className="size-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{integration.name}</p>
            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
              {integration.description}
            </p>
          </div>
        </div>
        <div className="shrink-0">
          {integration.configured ? (
            <Badge variant="success" appearance="light" size="sm">
              เชื่อมแล้ว
            </Badge>
          ) : (
            <Badge variant="secondary" size="sm">
              ยังไม่ตั้งค่า
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}

/* ── Password Field ──────────────────────────────────── */

function PasswordField({
  field,
  value,
  placeholder,
  onChange,
}: {
  field: RegistryField;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <Input
        id={field.key}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        aria-label={show ? 'ซ่อนรหัส' : 'แสดงรหัส'}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/* ── Config Drawer ───────────────────────────────────── */

function ConfigDrawer({
  open,
  onOpenChange,
  integrationKey,
  registry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integrationKey: string | null;
  registry: Registry;
}) {
  const queryClient = useQueryClient();
  const [formValues, setFormValues] = useState<IntegrationConfig>({});
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const entry = integrationKey ? registry[integrationKey] : null;

  // Fetch masked config when drawer opens
  const configQuery = useQuery<IntegrationConfig>({
    queryKey: ['integration-config', integrationKey],
    queryFn: () =>
      api.get(`/integrations/${integrationKey}/config`).then((r: any) => r.data),
    enabled: open && !!integrationKey,
  });

  // Pre-fill form with masked config — sensitive fields show as placeholder only
  const getInitialValues = (): IntegrationConfig => {
    if (!entry || !configQuery.data) return {};
    const vals: IntegrationConfig = {};
    for (const field of entry.fields) {
      if (field.type === 'password') {
        // Don't pre-fill password fields; use masked value as placeholder via configQuery
        vals[field.key] = '';
      } else {
        vals[field.key] = configQuery.data[field.key] ?? '';
      }
    }
    return vals;
  };

  // Initialise form once config loads
  useState(() => {
    if (configQuery.data && entry) {
      setFormValues(getInitialValues());
      setTestResult(null);
    }
  });

  // Reset when drawer closes or key changes
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setFormValues({});
      setTestResult(null);
    }
    onOpenChange(v);
  };

  // Also initialise when configQuery resolves
  const prevDataRef = { current: configQuery.data };
  if (configQuery.data !== prevDataRef.current) {
    prevDataRef.current = configQuery.data;
    if (configQuery.data && entry) {
      const vals: IntegrationConfig = {};
      for (const field of entry.fields) {
        if (field.type !== 'password') {
          vals[field.key] = configQuery.data[field.key] ?? '';
        } else {
          vals[field.key] = '';
        }
      }
      setFormValues(vals);
    }
  }

  const saveMutation = useMutation({
    mutationFn: (data: IntegrationConfig) =>
      api.put(`/integrations/${integrationKey}/config`, data),
    onSuccess: () => {
      toast.success('บันทึกการตั้งค่าเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      queryClient.invalidateQueries({ queryKey: ['integration-config', integrationKey] });
      handleOpenChange(false);
    },
    onError: () => {
      toast.error('ไม่สามารถบันทึกการตั้งค่าได้');
    },
  });

  const testMutation = useMutation({
    mutationFn: () => api.post(`/integrations/${integrationKey}/test`, formValues),
    onSuccess: (res: any) => {
      setTestResult({ success: true, message: res.data?.message ?? 'เชื่อมต่อสำเร็จ' });
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.message ?? 'เชื่อมต่อไม่ได้ — กรุณาตรวจสอบการตั้งค่า';
      setTestResult({ success: false, message: msg });
    },
  });

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    saveMutation.mutate(formValues);
  }

  if (!entry) return null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {(() => {
              const Icon = getIntegrationIcon(entry.key);
              return <Icon className="size-5 text-muted-foreground" />;
            })()}
            {entry.name}
          </SheetTitle>
          <SheetDescription>{entry.description}</SheetDescription>
        </SheetHeader>

        <SheetBody className="flex-1 overflow-y-auto">
          {configQuery.isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <form id="integration-config-form" onSubmit={handleSave} className="space-y-4">
              {entry.fields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <label
                    htmlFor={field.key}
                    className="text-sm font-medium text-foreground"
                  >
                    {field.label}
                    {field.required && (
                      <span className="text-destructive ml-1" aria-hidden="true">
                        *
                      </span>
                    )}
                  </label>
                  {field.type === 'password' ? (
                    <PasswordField
                      field={field}
                      value={formValues[field.key] ?? ''}
                      placeholder={
                        configQuery.data?.[field.key]
                          ? '●●●●●●●● (กรอกใหม่เพื่อเปลี่ยน)'
                          : field.placeholder ?? ''
                      }
                      onChange={(v) => setFormValues((prev) => ({ ...prev, [field.key]: v }))}
                    />
                  ) : field.type === 'boolean' ? (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id={field.key}
                        type="checkbox"
                        checked={formValues[field.key] === 'true'}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            [field.key]: e.target.checked ? 'true' : 'false',
                          }))
                        }
                        className="accent-primary"
                      />
                      <span className="text-sm text-muted-foreground">
                        {field.description ?? field.label}
                      </span>
                    </label>
                  ) : (
                    <Input
                      id={field.key}
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={formValues[field.key] ?? ''}
                      onChange={(e) =>
                        setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      placeholder={field.placeholder ?? ''}
                    />
                  )}
                  {field.description && field.type !== 'boolean' && (
                    <p className="text-xs text-muted-foreground">{field.description}</p>
                  )}
                </div>
              ))}

              {/* Test result */}
              {testResult && (
                <div
                  className={cn(
                    'flex items-start gap-2 p-3 rounded-lg text-sm',
                    testResult.success
                      ? 'bg-success/10 text-success border border-success/20'
                      : 'bg-destructive/10 text-destructive border border-destructive/20',
                  )}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="size-4 shrink-0 mt-0.5" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}
            </form>
          )}
        </SheetBody>

        <SheetFooter className="flex flex-col gap-2 sm:flex-col">
          <Button
            type="button"
            variant="outline"
            size="md"
            className="w-full"
            disabled={testMutation.isPending || configQuery.isLoading}
            onClick={() => testMutation.mutate()}
          >
            {testMutation.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                กำลังทดสอบ...
              </>
            ) : (
              <>
                <Plug className="size-4" />
                ทดสอบการเชื่อมต่อ
              </>
            )}
          </Button>
          <Button
            type="submit"
            form="integration-config-form"
            variant="primary"
            size="md"
            className="w-full"
            disabled={saveMutation.isPending || configQuery.isLoading}
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                กำลังบันทึก...
              </>
            ) : (
              'บันทึก'
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* ── Main Page ───────────────────────────────────────── */

function IntegrationGrid({
  integrations,
  registry,
}: {
  integrations: Integration[];
  registry: Registry;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function handleCardClick(key: string) {
    setSelectedKey(key);
    setDrawerOpen(true);
  }

  return (
    <>
      {integrations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Plug className="size-10 mb-3 opacity-30" />
          <p className="text-sm">ไม่พบการเชื่อมต่อ</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {integrations.map((integration) => (
            <IntegrationCard
              key={integration.key}
              integration={integration}
              onClick={() => handleCardClick(integration.key)}
            />
          ))}
        </div>
      )}

      <ConfigDrawer
        open={drawerOpen}
        onOpenChange={(v) => {
          setDrawerOpen(v);
          if (!v) setSelectedKey(null);
        }}
        integrationKey={selectedKey}
        registry={registry}
      />
    </>
  );
}

export default function IntegrationHubPage() {
  const integrationsQuery = useQuery<Integration[]>({
    queryKey: ['integrations'],
    queryFn: () => api.get('/integrations').then((r: any) => r.data),
  });

  const registryQuery = useQuery<Registry>({
    queryKey: ['integrations-registry'],
    queryFn: () => api.get('/integrations/registry').then((r: any) => r.data),
  });

  const isLoading = integrationsQuery.isLoading || registryQuery.isLoading;
  const isError = integrationsQuery.isError || registryQuery.isError;
  const error = integrationsQuery.error ?? registryQuery.error;

  return (
    <div>
      <PageHeader
        title="การเชื่อมต่อ"
        subtitle="ตั้งค่าและทดสอบการเชื่อมต่อกับระบบภายนอก"
      />
      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => {
          integrationsQuery.refetch();
          registryQuery.refetch();
        }}
      >
        <IntegrationGrid
          integrations={integrationsQuery.data ?? []}
          registry={registryQuery.data ?? {}}
        />
      </QueryBoundary>
    </div>
  );
}
