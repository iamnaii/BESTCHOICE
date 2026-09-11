import { useId, useState } from 'react';
import { Plus } from 'lucide-react';

interface FaqItem {
  question: string;
  answer: string;
}

export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const id = useId();
  const [expanded, setExpanded] = useState<number | null>(0);
  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const open = expanded === index;
        const buttonId = `${id}-question-${index}`;
        const panelId = `${id}-answer-${index}`;
        return (
          <div
            key={item.question}
            className={`overflow-hidden rounded-2xl border transition-colors ${open ? 'border-primary/30 bg-muted' : 'border-border bg-card'}`}
          >
            <h3>
              <button
                id={buttonId}
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setExpanded(open ? null : index)}
                className="flex min-h-14 w-full items-center justify-between gap-4 p-5 text-left text-base font-semibold leading-snug focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-primary"
              >
                {item.question}
                <Plus
                  aria-hidden="true"
                  className={`size-5 shrink-0 text-primary transition-transform duration-300 ${open ? 'rotate-45' : ''}`}
                />
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              aria-hidden={!open}
              inert={!open}
              className="grid transition-[grid-template-rows] duration-300 ease-out"
              style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
            >
              <div className="min-h-0 overflow-hidden">
                <p className="px-5 pb-5 text-sm text-muted-foreground leading-snug">
                  {item.answer}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
