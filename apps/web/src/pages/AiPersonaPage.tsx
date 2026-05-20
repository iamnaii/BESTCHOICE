import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bot, Lock, Sparkles } from 'lucide-react';

interface BotPersona {
  name: string;
  channels: string[];
  source: string;
  editable: boolean;
  prompt: string;
}

interface PersonaResponse {
  salesBot: BotPersona;
  serviceBot: BotPersona;
}

function PersonaCard({ persona, tone }: { persona: BotPersona; tone: 'sales' | 'service' }) {
  const accentClass =
    tone === 'service'
      ? 'border-primary/30 bg-primary/5'
      : 'border-accent bg-accent/30';

  return (
    <Card className={accentClass}>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2 leading-snug">
          {tone === 'service' ? (
            <Sparkles className="w-4 h-4 text-primary" />
          ) : (
            <Bot className="w-4 h-4 text-muted-foreground" />
          )}
          {persona.name}
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
      <PageHeader
        title="AI Persona"
        subtitle="ตัวตน บุคลิก และกฎการตอบของบอททั้ง 2 ตัว"
      />

      <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 mb-6 flex items-start gap-3">
        <Lock className="w-5 h-5 text-warning mt-0.5 shrink-0" />
        <div className="text-sm leading-snug">
          <p className="font-semibold text-foreground">โหมดอ่านอย่างเดียว (Phase A)</p>
          <p className="text-muted-foreground mt-1">
            ตอนนี้ persona ฝังในโค้ด แก้ต้องให้ dev อัปเดตไฟล์ + redeploy
            <br />
            Phase B (sprint หน้า): ย้ายไป DB → admin แก้ผ่าน UI ได้ + เก็บ version history
          </p>
        </div>
      </div>

      <QueryBoundary
        isLoading={personaQuery.isLoading}
        isError={personaQuery.isError}
        error={personaQuery.error}
        onRetry={() => personaQuery.refetch()}
      >
        {personaQuery.data && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PersonaCard persona={personaQuery.data.salesBot} tone="sales" />
            <PersonaCard persona={personaQuery.data.serviceBot} tone="service" />
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}
