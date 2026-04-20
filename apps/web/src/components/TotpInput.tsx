import { useRef, KeyboardEvent, ClipboardEvent, ChangeEvent } from 'react';
import { cn } from '@/lib/utils';

interface TotpInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export default function TotpInput({ value, onChange, onComplete, disabled, className }: TotpInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, '').split('').slice(0, 6);

  function focusAt(index: number) {
    inputRefs.current[index]?.focus();
  }

  function handleChange(index: number, e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) return;

    const digit = raw[raw.length - 1];
    const next = digits.slice();
    next[index] = digit;
    const joined = next.join('');
    onChange(joined);

    if (index < 5) {
      focusAt(index + 1);
    } else {
      // last digit filled
      inputRefs.current[index]?.blur();
      if (joined.length === 6) {
        onComplete?.(joined);
      }
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[index]) {
        // clear current
        const next = digits.slice();
        next[index] = '';
        onChange(next.join(''));
      } else if (index > 0) {
        // move to previous
        const next = digits.slice();
        next[index - 1] = '';
        onChange(next.join(''));
        focusAt(index - 1);
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      focusAt(index - 1);
    } else if (e.key === 'ArrowRight' && index < 5) {
      e.preventDefault();
      focusAt(index + 1);
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    onChange(pasted);
    // focus last filled or last box
    const lastIndex = Math.min(pasted.length - 1, 5);
    focusAt(lastIndex);
    if (pasted.length === 6) {
      onComplete?.(pasted);
    }
  }

  return (
    <div className={cn('flex gap-2 justify-center', className)} aria-label="รหัส OTP 6 หลัก">
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { inputRefs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]"
          maxLength={1}
          value={digits[i] ?? ''}
          disabled={disabled}
          aria-label={`หลักที่ ${i + 1}`}
          className={cn(
            'w-11 h-14 text-center text-xl font-bold rounded-lg border-2 transition-colors',
            'bg-background text-foreground',
            'border-border focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            digits[i] && 'border-primary/60',
          )}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
        />
      ))}
    </div>
  );
}
