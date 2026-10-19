import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

/** Keep children mounted so collapsing a section does not discard drafts or query state. */
export default function DossierDisclosure({ title, summary, children, open, onOpenChange, className }: {
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const expanded = open ?? localOpen;
  return (
    <Collapsible open={expanded} onOpenChange={onOpenChange ?? setLocalOpen} className={cn('inbox-dossier-disclosure', className)}>
      <h3>
        <CollapsibleTrigger aria-label={title} className="inbox-dossier-disclosure-trigger">
          <span className="min-w-0 text-left"><span className="block font-semibold">{title}</span>{summary && <span className="mt-1 block text-xs font-normal leading-snug text-muted-foreground">{summary}</span>}</span>
          <ChevronDown aria-hidden="true" className={cn('size-4 shrink-0 transition-transform', expanded && 'rotate-180')} />
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent forceMount hidden={!expanded} className="inbox-dossier-disclosure-body">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
