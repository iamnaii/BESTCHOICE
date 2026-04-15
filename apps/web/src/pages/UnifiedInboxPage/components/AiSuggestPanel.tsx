import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  sessionId: string;
  onSelectSuggestion: (text: string) => void;
  lastMessageAt: number;
}

export default function AiSuggestPanel({
  sessionId,
  onSelectSuggestion,
  lastMessageAt,
}: AiSuggestPanelProps) {
  const { data, isLoading, isError } = useQuery<AiSuggestResponse>({
    queryKey: ['ai-suggest', sessionId, lastMessageAt],
    queryFn: () =>
      api
        .post<AiSuggestResponse>(`/staff-chat/sessions/${sessionId}/suggest`, {})
        .then((r) => r.data),
    enabled: !!sessionId,
    staleTime: 30_000,
    retry: false,
  });

  if (isError || (!isLoading && (!data || data.suggestions.length === 0))) {
    return null;
  }

  const intentLabel: Record<string, string> = {
    answer_price: '💰 ตอบราคา',
    close_sale: '🎯 ปิดการขาย',
    answer_spec: '📱 ตอบสเปค',
    answer_stock: '📦 ตอบสต็อก',
    answer_promotion: '🎁 แนะนำโปร',
    ask_preference: '❓ ถามความต้องการ',
    greet: '👋 ทักทาย',
    follow_up: '📞 ติดตาม',
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
          {data?.suggestions.map((suggestion, i) => (
            <button
              key={i}
              onClick={() => onSelectSuggestion(suggestion.text)}
              className={cn(
                'flex-1 min-w-[200px] max-w-[300px] text-left px-3 py-2 rounded-lg border transition-all duration-150',
                'text-[12px] leading-relaxed text-foreground/80',
                'border-border/60 bg-background hover:border-primary/40 hover:bg-primary/5',
                'active:scale-[0.98]',
              )}
            >
              <p className="line-clamp-3">{suggestion.text}</p>
              <span className="text-[10px] text-muted-foreground/60 mt-1 block">
                {intentLabel[suggestion.intent] ?? suggestion.intent}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
