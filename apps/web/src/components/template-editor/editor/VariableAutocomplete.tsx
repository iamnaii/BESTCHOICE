import { useState, useRef, useEffect, useCallback } from 'react';
import { AVAILABLE_VARIABLES, VARIABLE_GROUPS } from '@/constants/variables';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

export default function VariableAutocomplete({ value, onChange, placeholder, rows = 8 }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [filter, setFilter] = useState('');
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    onChange(val);

    // Check if we should show autocomplete
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = val.substring(0, cursorPos);
    const match = textBeforeCursor.match(/\{\{=?\s*([A-Z_.]*)$/);

    if (match) {
      setFilter(match[1].toLowerCase());
      setShowDropdown(true);
      // Position dropdown near cursor (approximate)
      const lines = textBeforeCursor.split('\n');
      const lineNum = lines.length;
      const colNum = lines[lines.length - 1].length;
      setDropdownPos({
        top: Math.min(lineNum * 24, 200),
        left: Math.min(colNum * 8, 400),
      });
    } else {
      setShowDropdown(false);
    }
  }, [onChange]);

  const insertVariable = useCallback((key: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBefore = value.substring(0, cursorPos);
    const textAfter = value.substring(cursorPos);

    // Find start of the {{ pattern
    const match = textBefore.match(/\{\{=?\s*[A-Z_.]*$/);
    if (match) {
      const start = cursorPos - match[0].length;
      const newText = value.substring(0, start) + `{{= ${key}}}` + textAfter;
      onChange(newText);

      // Move cursor after inserted variable
      setTimeout(() => {
        const newPos = start + `{{= ${key}}}`.length;
        textarea.selectionStart = textarea.selectionEnd = newPos;
        textarea.focus();
      }, 0);
    }
    setShowDropdown(false);
  }, [value, onChange]);

  const filteredVars = AVAILABLE_VARIABLES.filter(v =>
    v.type !== 'array' && (
      v.key.toLowerCase().includes(filter) ||
      v.label.toLowerCase().includes(filter)
    )
  );

  // Close dropdown on escape or click outside
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowDropdown(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-3 py-2.5 border border-input rounded-lg text-base font-mono focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-y"
        spellCheck={false}
      />

      {showDropdown && filteredVars.length > 0 && (
        <div
          className="absolute z-50 bg-card border border-border rounded-lg shadow-xl max-h-60 overflow-y-auto w-80"
          style={{ top: dropdownPos.top + 30, left: Math.min(dropdownPos.left, 100) }}
        >
          {VARIABLE_GROUPS.map(group => {
            const vars = filteredVars.filter(v => {
              if (group.altPrefix) {
                return v.key.startsWith(group.prefix) || v.key.startsWith(group.altPrefix);
              }
              return v.key.startsWith(group.prefix);
            });
            if (vars.length === 0) return null;
            return (
              <div key={group.label}>
                <div className="px-3 py-1.5 text-xs font-bold text-muted-foreground uppercase bg-muted sticky top-0">
                  {group.label}
                </div>
                {vars.map(v => (
                  <button
                    key={v.key}
                    onClick={() => insertVariable(v.key)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-primary-50 transition-colors"
                  >
                    <span className="text-sm font-mono text-primary-700">{v.key}</span>
                    <span className="text-xs text-muted-foreground flex-1 truncate">{v.label}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{v.type}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
