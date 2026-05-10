import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Bookmark, FileEdit, Files, Sparkles, X, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TemplateRow {
  id: string;
  name: string;
  documentType: 'EXPENSE' | 'CREDIT_NOTE' | 'PAYROLL' | 'VENDOR_SETTLEMENT';
  isRecurring: boolean;
  prefilledData: {
    vendorName?: string;
    description?: string;
    category?: string;
    sampleAmount?: number;
  };
}

interface Props {
  branchId: string;
  onMode: (mode: 'blank' | 'template' | 'copy') => void;
  onPickTemplate: (tplId: string) => void;
  onClose: () => void;
}

export function QuickStartPanel({ branchId, onMode, onPickTemplate, onClose }: Props) {
  const { data: templates } = useQuery<TemplateRow[]>({
    queryKey: ['expense-templates', branchId],
    queryFn: async () => (await api.get(`/expense-templates?branchId=${branchId}`)).data,
    enabled: !!branchId,
  });
  const top6 = (templates ?? []).slice(0, 6);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="text-sm font-medium">เริ่มต้นเร็ว</span>
        </div>
        <button onClick={onClose} aria-label="ปิด" className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <ModeCard
            Icon={FileEdit}
            label="เริ่มเปล่า"
            sub="กรอกใหม่ทั้งหมด"
            onClick={() => onMode('blank')}
          />
          <ModeCard
            Icon={Bookmark}
            label="จาก Template"
            sub={`${templates?.length ?? 0} รายการพร้อมใช้`}
            onClick={() => onMode('template')}
            accent
          />
          <ModeCard
            Icon={Files}
            label="คัดลอกเก่า"
            sub="เปิด ListPage เพื่อหา"
            onClick={() => onMode('copy')}
          />
        </div>
        {top6.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-2">ใช้บ่อย</div>
            <div className="grid grid-cols-3 gap-3">
              {top6.map((tpl) => (
                <button
                  type="button"
                  key={tpl.id}
                  onClick={() => onPickTemplate(tpl.id)}
                  className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 text-left hover:bg-accent transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={cn(
                          'text-xs font-medium px-1.5 py-0.5 rounded',
                          tpl.isRecurring
                            ? 'bg-warning/10 text-warning'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {tpl.isRecurring ? 'recur' : 'manual'}
                      </span>
                      {tpl.isRecurring && <Star className="size-3 text-warning" />}
                    </div>
                    <div className="text-sm font-medium leading-snug truncate">{tpl.name}</div>
                    <div className="text-xs text-muted-foreground leading-snug">
                      <span className="font-mono">{tpl.prefilledData.category ?? '—'}</span>
                      {tpl.prefilledData.vendorName && ` · ${tpl.prefilledData.vendorName}`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ModeCard({
  Icon,
  label,
  sub,
  onClick,
  accent,
}: {
  Icon: typeof FileEdit;
  label: string;
  sub: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors',
        accent ? 'border-primary/40 bg-primary/5 hover:bg-primary/10' : 'border-border bg-card hover:bg-accent',
      )}
    >
      <Icon className={cn('size-5 mt-0.5', accent ? 'text-primary' : 'text-muted-foreground')} />
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
    </button>
  );
}
