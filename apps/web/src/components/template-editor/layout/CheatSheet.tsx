import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { SYNTAX_REFERENCE } from '@/constants/syntaxReference';

export default function CheatSheet() {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = (syntax: string) => {
    navigator.clipboard.writeText(syntax);
    setCopied(syntax);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="w-[300px] bg-card border-r border-border overflow-y-auto">
      <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm border-b border-border px-4 py-3">
        <h3 className="text-base font-bold text-foreground">Template Syntax</h3>
        <p className="text-sm text-muted-foreground mt-0.5">คลิกเพื่อ copy syntax</p>
      </div>

      <div className="p-4 space-y-5">
        {SYNTAX_REFERENCE.map(group => (
          <div key={group.group}>
            <div className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2.5">{group.group}</div>
            <div className="flex flex-wrap gap-2">
              {group.items.map(item => (
                <button
                  key={item.syntax}
                  onClick={() => handleCopy(item.syntax)}
                  className={`group/item relative inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm font-mono transition-all hover:shadow-sm ${item.bgColor} ${item.color} hover:opacity-90`}
                  title={`คลิกเพื่อ copy: ${item.syntax}`}
                >
                  <span className="truncate max-w-[200px]">{item.label}</span>
                  {copied === item.syntax ? (
                    <Check size={14} className="text-green-600 flex-shrink-0" />
                  ) : (
                    <Copy size={14} className="opacity-0 group-hover/item:opacity-100 flex-shrink-0 transition-opacity" />
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Quick variable reference */}
        <div className="pt-4 border-t border-border">
          <div className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2.5">ตัวอย่าง</div>
          <div className="space-y-1.5 text-sm text-foreground font-mono bg-muted rounded-lg p-3 leading-relaxed">
            <p><span className="text-primary-600">{'{{= CONTRACT.NUMBER}}'}</span></p>
            <p><span className="text-teal-600">{'{{= CONTRACT.DATE | date:l}}'}</span></p>
            <p><span className="text-teal-600">{'{{= CONTRACT.TOTAL_AMOUNT | num:2}}'}</span></p>
            <p className="text-primary-600 mt-2">{'{{for ITEM in INSTALLMENTS}}'}</p>
            <p className="ml-3 text-primary-600">{'{{= ITEM.NO}} {{= ITEM.AMOUNT | num:2}}'}</p>
            <p className="text-primary-600">{'{{/for}}'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
