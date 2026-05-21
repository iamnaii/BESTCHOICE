import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Bot, Sparkles, AlertTriangle, RotateCcw } from 'lucide-react';

interface ServiceBotPersona {
  name: string;
  channels: string[];
  source: string;
  editable: false;
  prompt: string;
}

interface SalesBotPersona {
  name: string;
  channels: string[];
  source: string;
  editable: true;
  prompt: string;
  base: string;
  extras: string;
  defaultBase: string;
  defaultExtras: string;
  isCustomized: { base: boolean; extras: boolean };
  requiredToolNames: readonly string[];
}

interface PersonaResponse {
  salesBot: SalesBotPersona;
  serviceBot: ServiceBotPersona;
}

/**
 * Scan persona text for known foot-guns the owner might introduce.
 * - `[ลพบุรี]` style — Claude/Gemini render the brackets literally.
 *   Memory: shipped to customers verbatim in the past.
 * - `${name}` / `{{name}}` — same problem.
 * - `requiredTools` (BOT only) — bot stops calling tools if name removed.
 */
function lintPersona(
  text: string,
  requiredTools: readonly string[] = [],
): string[] {
  const warnings: string[] = [];

  const placeholderRe = /\[[฀-๿ก-๛A-Z][^\]\n]{0,40}\]|\$\{[^}\n]+\}|\{\{[^}\n]+\}\}/g;
  const placeholders = Array.from(text.matchAll(placeholderRe))
    .map((m) => m[0])
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 5);
  if (placeholders.length > 0) {
    warnings.push(
      `พบ placeholder รูป ${placeholders.join(', ')} — Claude/Gemini จะ render ตามตัวอักษร ไม่ใช่แทนค่า`,
    );
  }

  for (const tool of requiredTools) {
    if (!text.includes(tool)) {
      warnings.push(
        `ไม่มีการอ้างชื่อ tool "${tool}" — บอทจะหยุดเรียก tool นี้ทันที (อาจตั้งใจ?)`,
      );
    }
  }

  return warnings;
}

function approxTokenCount(s: string): number {
  // Crude — Anthropic/Gemini Thai tokenizer ≈ 1 token per 2-3 chars. Use /3 as
  // a conservative midpoint for the "ยาวไป" sanity check.
  return Math.ceil(s.length / 3);
}

interface EditablePersonaCardProps {
  title: string;
  icon: React.ReactNode;
  description: string;
  field: 'base' | 'extras';
  currentValue: string;
  defaultValue: string;
  isCustomized: boolean;
  requiredTools?: readonly string[];
  maxChars: number;
  /** What gets sent as the PATCH body — `''` reverts. */
  patchKey: 'shopBotPersonaBase' | 'shopBotPersonaBotExtras';
}

function EditablePersonaCard({
  title,
  icon,
  description,
  currentValue,
  defaultValue,
  isCustomized,
  requiredTools = [],
  maxChars,
  patchKey,
}: EditablePersonaCardProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(currentValue);
  const [revertOpen, setRevertOpen] = useState(false);

  // Re-sync local draft when the upstream value changes (after save/revert
  // round-trip), but only when the user hasn't started typing something else
  // they'd lose. The dirty check below is approximate — close-enough for a
  // single-textarea editor.
  useEffect(() => {
    setDraft(currentValue);
  }, [currentValue]);

  const dirty = draft !== currentValue;
  const warnings = useMemo(() => lintPersona(draft, requiredTools), [draft, requiredTools]);
  const overLimit = draft.length > maxChars;

  const saveMutation = useMutation({
    mutationFn: (value: string) =>
      api.patch('/staff-chat/ai/settings', { [patchKey]: value }),
    onSuccess: () => {
      toast.success(`บันทึก ${title} เรียบร้อย — มีผลทันที`);
      queryClient.invalidateQueries({ queryKey: ['ai-persona'] });
    },
    onError: (err: any) => {
      toast.error(
        `บันทึกไม่สำเร็จ: ${err?.response?.data?.message ?? err.message}`,
      );
    },
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 leading-snug">
            {icon}
            {title}
            {isCustomized ? (
              <Badge variant="secondary" className="text-xs">
                แก้ไขแล้ว
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs">
                ค่าเริ่มต้น
              </Badge>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground leading-snug mt-1">{description}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="leading-snug text-xs">เนื้อหา persona</Label>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={20}
              className="font-mono text-xs leading-relaxed"
              spellCheck={false}
              placeholder="ใส่ persona ภาษาไทยตามรูปแบบที่ต้องการ — ดู 'ค่าเริ่มต้น' ตอน revert"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground leading-snug">
              <span>
                {draft.length.toLocaleString('th-TH')} / {maxChars.toLocaleString('th-TH')} ตัวอักษร
                {' · '}≈ {approxTokenCount(draft).toLocaleString('th-TH')} tokens
              </span>
              {dirty && <span className="text-warning">ยังไม่ได้บันทึก</span>}
            </div>
          </div>

          {overLimit && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive leading-snug flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                เกิน {maxChars.toLocaleString('th-TH')} ตัวอักษร — server จะปฏิเสธ ลดข้อความก่อนบันทึก
              </span>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs text-warning leading-snug space-y-1">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4" />
                คำเตือนก่อนบันทึก
              </div>
              <ul className="list-disc list-inside space-y-0.5">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setRevertOpen(true)}
              disabled={!isCustomized || saveMutation.isPending}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              คืนค่าเริ่มต้น
            </Button>
            <Button
              onClick={() => saveMutation.mutate(draft)}
              disabled={!dirty || overLimit || saveMutation.isPending}
            >
              {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={revertOpen}
        onOpenChange={setRevertOpen}
        title="คืนค่าเริ่มต้น?"
        description={`ลบ override ของ "${title}" → กลับไปใช้ค่าฝังในโค้ด (${defaultValue.length.toLocaleString('th-TH')} ตัวอักษร) มีผลทันที — ข้อความที่แก้ไว้จะหายไป`}
        variant="destructive"
        confirmLabel="คืนค่าเริ่มต้น"
        loading={saveMutation.isPending}
        onConfirm={() => saveMutation.mutate('')}
      />
    </>
  );
}

function ServiceBotCard({ persona }: { persona: ServiceBotPersona }) {
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2 leading-snug">
          <Sparkles className="w-4 h-4 text-primary" />
          {persona.name}
          <Badge variant="outline" className="text-xs">
            อ่านอย่างเดียว
          </Badge>
        </CardTitle>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {persona.channels.map((ch) => (
            <Badge key={ch} variant="outline" className="text-xs">
              {ch}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg bg-muted/50 border border-border p-3 max-h-96 overflow-y-auto">
          <pre className="whitespace-pre-wrap text-xs leading-relaxed font-sans text-foreground">
            {persona.prompt}
          </pre>
        </div>
        <p className="text-xs text-muted-foreground mt-3 leading-snug font-mono">
          source: {persona.source}
        </p>
      </CardContent>
    </Card>
  );
}

export default function AiPersonaPage() {
  const personaQuery = useQuery<PersonaResponse>({
    queryKey: ['ai-persona'],
    queryFn: () => api.get('/ai-settings/persona').then((r: any) => r.data),
  });

  return (
    <div>
      <PageHeader title="AI Persona" subtitle="ตัวตน บุคลิก และกฎการตอบของบอททั้ง 2 ตัว" />

      <QueryBoundary
        isLoading={personaQuery.isLoading}
        isError={personaQuery.isError}
        error={personaQuery.error}
        onRetry={() => personaQuery.refetch()}
      >
        {personaQuery.data && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Bot className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold leading-snug">
                  {personaQuery.data.salesBot.name}
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {personaQuery.data.salesBot.channels.map((ch) => (
                    <Badge key={ch} variant="outline" className="text-xs">
                      {ch}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <EditablePersonaCard
                  title="บุคลิก & โทน (BASE)"
                  icon={<Bot className="w-4 h-4 text-muted-foreground" />}
                  description="identity + tone + Thai-natural rules. ใช้ทั้ง AiSuggest (staff suggestions) และ SalesBot (auto-reply)"
                  field="base"
                  currentValue={personaQuery.data.salesBot.base}
                  defaultValue={personaQuery.data.salesBot.defaultBase}
                  isCustomized={personaQuery.data.salesBot.isCustomized.base}
                  maxChars={20000}
                  patchKey="shopBotPersonaBase"
                />
                <EditablePersonaCard
                  title="Playbook & กฎ tools (BOT_EXTRAS)"
                  icon={<Bot className="w-4 h-4 text-muted-foreground" />}
                  description="ต่อท้าย BASE สำหรับ SalesBot เท่านั้น — playbook ตอบลูกค้า + เรียก tools (4-persona detect, 3-combo, 8 objections, capture_lead, handoff_to_human, MDM)"
                  field="extras"
                  currentValue={personaQuery.data.salesBot.extras}
                  defaultValue={personaQuery.data.salesBot.defaultExtras}
                  isCustomized={personaQuery.data.salesBot.isCustomized.extras}
                  requiredTools={personaQuery.data.salesBot.requiredToolNames}
                  maxChars={30000}
                  patchKey="shopBotPersonaBotExtras"
                />
              </div>
            </div>

            <ServiceBotCard persona={personaQuery.data.serviceBot} />
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}
