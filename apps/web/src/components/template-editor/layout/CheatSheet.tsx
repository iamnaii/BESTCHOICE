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
    <div className="w-[280px] bg-gray-50 border-r border-gray-200 overflow-y-auto p-4">
      <h3 className="text-sm font-bold text-gray-500 uppercase mb-3">Template Syntax</h3>

      {SYNTAX_REFERENCE.map(group => (
        <div key={group.group} className="mb-4">
          <div className="text-xs font-bold text-gray-400 uppercase mb-2">{group.group}</div>
          <div className="flex flex-wrap gap-1.5">
            {group.items.map(item => (
              <button
                key={item.syntax}
                onClick={() => handleCopy(item.syntax)}
                className={`group relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-mono transition-all ${item.bgColor} ${item.color} hover:opacity-80`}
                title={`คลิกเพื่อ copy: ${item.syntax}`}
              >
                <span className="truncate max-w-[190px]">{item.label}</span>
                {copied === item.syntax ? (
                  <Check size={12} className="text-green-600 flex-shrink-0" />
                ) : (
                  <Copy size={12} className="opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity" />
                )}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Quick variable reference */}
      <div className="mt-4 pt-3 border-t border-gray-200">
        <div className="text-xs font-bold text-gray-400 uppercase mb-2">ตัวอย่าง</div>
        <div className="space-y-1.5 text-xs text-gray-600 font-mono">
          <p><span className="text-violet-600">{'{{= CONTRACT.NUMBER}}'}</span></p>
          <p><span className="text-teal-600">{'{{= CONTRACT.DATE | date:l}}'}</span></p>
          <p><span className="text-teal-600">{'{{= CONTRACT.TOTAL_AMOUNT | num:2}}'}</span></p>
          <p className="text-blue-600">{'{{for ITEM in INSTALLMENTS}}'}</p>
          <p className="ml-2 text-violet-600">{'{{= ITEM.NO}} {{= ITEM.AMOUNT | num:2}}'}</p>
          <p className="text-blue-600">{'{{/for}}'}</p>
        </div>
      </div>
    </div>
  );
}
