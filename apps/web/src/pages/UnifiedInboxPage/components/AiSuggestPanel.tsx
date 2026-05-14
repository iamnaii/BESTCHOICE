import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Sparkles, Loader2, Banknote, Target, Smartphone, Package, Gift, HelpCircle, Hand, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface AiSuggestion {
  text: string;
  intent: string;
  confidence: number;
}

interface AiSuggestResponse {
  suggestions: AiSuggestion[];
  detectedProducts: string[];
  processingTimeMs: number;
}

interface AiSuggestPanelProps {
  roomId: string;
  onSelectSuggestion: (text: string, metadata: { aiDraft: string; intent: string }) => void;
  lastMessageAt: number;
}

export default function AiSuggestPanel({
  roomId,
  onSelectSuggestion,
  lastMessageAt,
}: AiSuggestPanelProps) {
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissed when new message arrives
  useEffect(() => {
    setDismissed(false);
  }, [lastMessageAt]);

  const { data, isLoading, isError } = useQuery<AiSuggestResponse>({
    queryKey: ['ai-suggest', roomId, lastMessageAt],
    queryFn: () =>
      api
        .post<AiSuggestResponse>(`/staff-chat/rooms/${roomId}/suggest`, {})
        .then((r) => r.data),
    enabled: !!roomId && !dismissed,
    staleTime: 30_000,
    retry: false,
  });

  if (dismissed || isError || (!isLoading && (!data || data.suggestions.length === 0))) {
    return null;
  }

  const intentMeta: Record<string, { icon: LucideIcon; label: string }> = {
    answer_price:     { icon: Banknote,    label: 'ตอบราคา' },
    close_sale:       { icon: Target,      label: 'ปิดการขาย' },
    answer_spec:      { icon: Smartphone,  label: 'ตอบสเปค' },
    answer_stock:     { icon: Package,     label: 'ตอบสต็อก' },
    answer_promotion: { icon: Gift,        label: 'แนะนำโปร' },
    ask_preference:   { icon: HelpCircle,  label: 'ถามความต้องการ' },
    greet:            { icon: Hand,        label: 'ทักทาย' },
    follow_up:        { icon: Phone,       label: 'ติดตาม' },
  };

  return (
    <div className="border-t border-border/50 bg-muted/30 px-4 py-2.5">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles className="size-3.5 text-primary" />
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          AI แนะนำ
        </span>
        {isLoading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
      </div>

      {isLoading ? (
        <div className="flex gap-2">
          {[1, 2].map((i) => (
            <div key={i} className="flex-1 h-16 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {data?.suggestions.map((suggestion, i) => {
            const meta = intentMeta[suggestion.intent];
            const Icon = meta?.icon;
            return (
              <button
                key={i}
                onClick={() => {
                  onSelectSuggestion(suggestion.text, { aiDraft: suggestion.text, intent: suggestion.intent });
                  setDismissed(true);
                }}
                className={cn(
                  'flex-1 min-w-[200px] max-w-[300px] text-left px-3 py-2 rounded-lg border transition-all duration-150',
                  'text-[12px] leading-relaxed text-foreground/80',
                  'border-border/60 bg-background hover:border-primary/40 hover:bg-primary/5',
                  'active:scale-[0.98]',
                )}
              >
                <p className="line-clamp-3">{suggestion.text}</p>
                <span className="text-[10px] text-muted-foreground/60 mt-1 flex items-center gap-1">
                  {meta && Icon ? <><Icon className="size-3" />{meta.label}</> : suggestion.intent}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
