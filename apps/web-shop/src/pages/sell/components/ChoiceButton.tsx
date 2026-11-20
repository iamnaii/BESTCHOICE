import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
export default function ChoiceButton({ selected, children, onClick, disabled, label, multiple=false }: { selected:boolean; children:ReactNode; onClick:()=>void; disabled?:boolean; label?:string; multiple?:boolean }) {
 return <button type="button" aria-label={label} role={multiple?'checkbox':undefined} aria-checked={multiple?selected:undefined} aria-pressed={multiple?undefined:selected} disabled={disabled} onClick={onClick}
 className={`flex min-h-[58px] w-full items-center justify-between gap-3 rounded-2xl border p-3.5 text-left text-base leading-snug focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default ${selected?'border-primary bg-secondary':'border-border bg-card'}`}>
  <span className="min-w-0 flex-1 break-words">{children}</span><span aria-hidden="true" className={`flex size-[22px] shrink-0 items-center justify-center border ${multiple?'rounded-md':'rounded-full'} ${selected?'border-primary bg-primary text-primary-foreground':'border-foreground'}`}>{selected&&<Check size={16}/>}</span>
 </button>;
}
