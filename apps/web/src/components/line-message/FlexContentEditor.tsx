import type { ReactNode } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  FLEX_TEMPLATES,
  type FlexContent,
  type FlexMode,
  type FlexTemplateKey,
} from '@/lib/line-flex';
import { FlexPreviewCard } from './FlexPreviewCard';

export function FlexContentEditor<T extends FlexContent>({
  content: c,
  onChange,
  children,
  templateHoverClass = 'hover:border-primary/60',
}: {
  content: T;
  onChange: (content: T) => void;
  children?: ReactNode;
  templateHoverClass?: 'hover:border-primary/50' | 'hover:border-primary/60';
}) {
  const tpl = FLEX_TEMPLATES[c.templateKey];

  return (
    <div className="space-y-4">
      {children}
      {/* Mode toggle */}
      <div className="flex gap-1 rounded-full bg-muted p-1 w-fit">
        {(['template', 'json'] as FlexMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChange({ ...c, flexMode: mode })}
            className={cn(
              'rounded-full px-5 py-1.5 text-sm font-medium transition-all duration-200',
              c.flexMode === mode
                ? 'bg-card text-primary shadow-sm'
                : 'text-muted-foreground hover:text-foreground/80',
            )}
          >
            {mode === 'template' ? 'Template' : 'JSON'}
          </button>
        ))}
      </div>

      {c.flexMode === 'template' ? (
        <div className="space-y-4">
          {/* Template selector */}
          <div className="flex flex-wrap gap-2">
            {(
              Object.entries(FLEX_TEMPLATES) as [
                FlexTemplateKey,
                { name: string; fields: string[] },
              ][]
            ).map(([key, t]) => (
              <button
                key={key}
                type="button"
                onClick={() => onChange({ ...c, templateKey: key, fields: {} })}
                className={cn(
                  'rounded-full border-2 px-4 py-1.5 text-sm font-medium transition-all duration-200',
                  c.templateKey === key
                    ? 'border-primary bg-primary/5 text-primary shadow-sm'
                    : `border-border text-foreground/70 ${templateHoverClass} hover:text-primary`,
                )}
              >
                {t.name}
              </button>
            ))}
          </div>
          {/* Dynamic fields */}
          <div className="space-y-3">
            {tpl.fields.map((fieldName) => (
              <div key={fieldName}>
                <label className="mb-1.5 block text-sm font-medium text-foreground/80">
                  {fieldName}
                  {fieldName === tpl.fields[0] && (
                    <span className="text-destructive ml-0.5">*</span>
                  )}
                </label>
                <Input
                  placeholder={fieldName}
                  value={c.fields[fieldName] || ''}
                  onChange={(e) =>
                    onChange({ ...c, fields: { ...c.fields, [fieldName]: e.target.value } })
                  }
                />
              </div>
            ))}
          </div>
          {/* Mini preview */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Preview
            </p>
            <FlexPreviewCard content={c} />
          </div>
        </div>
      ) : (
        /* JSON mode */
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              JSON Editor
            </p>
            <div className="rounded-xl overflow-hidden border border-border shadow-sm">
              <div className="bg-muted px-3 py-2 flex items-center gap-2 border-b border-border">
                <div className="flex gap-1.5">
                  <div className="size-2.5 rounded-full bg-destructive" />
                  <div className="size-2.5 rounded-full bg-warning" />
                  <div className="size-2.5 rounded-full bg-success" />
                </div>
                <span className="text-xs text-muted-foreground ml-1">flex.json</span>
              </div>
              <Textarea
                className="font-mono text-xs bg-card text-foreground min-h-[200px] resize-y border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0"
                value={c.jsonText}
                onChange={(e) => {
                  const text = e.target.value;
                  let valid = false;
                  try {
                    JSON.parse(text);
                    valid = true;
                  } catch {
                    valid = false;
                  }
                  onChange({ ...c, jsonText: text, jsonValid: valid });
                }}
              />
            </div>
            {c.jsonValid ? (
              <span className="flex items-center gap-1.5 text-xs text-success">
                <CheckCircle2 className="size-3.5" />
                JSON ถูกต้อง
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-destructive">
                <X className="size-3.5" />
                JSON ไม่ถูกต้อง
              </span>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Live Preview
            </p>
            <FlexPreviewCard content={c} />
          </div>
        </div>
      )}
    </div>
  );
}
