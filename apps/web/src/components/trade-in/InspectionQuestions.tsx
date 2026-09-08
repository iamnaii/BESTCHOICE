import { useId } from 'react';
import { Check } from 'lucide-react';
import type { BuybackQuestion, BuybackQuestionsResponse } from '@installment/shared';
import { cn } from '@/lib/utils';

interface Props {
  questionnaire: BuybackQuestionsResponse;
  selected: Record<string, string[]>;
  onChange: (next: Record<string, string[]>) => void;
  deviceEligibilityConfirmed: boolean;
  onEligibilityChange: (confirmed: boolean) => void;
  disabled?: boolean;
}

// An absent key means not inspected. MULTI [] means explicitly checked with no issues.
export function isQuestionAnswered(question: BuybackQuestion, selected: Record<string, string[]>) {
  return (
    Object.prototype.hasOwnProperty.call(selected, question.key) &&
    (question.selectType === 'MULTI' || selected[question.key].length === 1) &&
    selected[question.key].every((id) => question.choices.some((choice) => choice.id === id))
  );
}

export default function InspectionQuestions({
  questionnaire,
  selected,
  onChange,
  deviceEligibilityConfirmed,
  onEligibilityChange,
  disabled = false,
}: Props) {
  const fieldId = useId();
  const answered = (question: BuybackQuestion) => isQuestionAnswered(question, selected);

  function pick(question: BuybackQuestion, choiceId: string) {
    if (disabled) return;
    if (question.selectType === 'SINGLE') {
      onChange({ ...selected, [question.key]: [choiceId] });
      return;
    }
    const current = selected[question.key] ?? [];
    const choices = current.includes(choiceId)
      ? current.filter((id) => id !== choiceId)
      : [...current, choiceId];
    const next = { ...selected };
    if (choices.length) next[question.key] = choices;
    else delete next[question.key]; // Unchecking the last issue requires explicit no-issue confirmation.
    onChange(next);
  }

  return (
    <>
      {questionnaire.source && (
        <p className="border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
          ราคาและเงื่อนไขอ้างอิง Yellobe
          {questionnaire.capturedAt &&
            ` · ข้อมูล ณ ${new Date(questionnaire.capturedAt).toLocaleDateString('th-TH')}`}
          <br />
          ค่าหักเป็นบาทรวมกัน แล้วหักเปอร์เซ็นต์ที่สูงที่สุดตามผลตรวจ
        </p>
      )}
      {questionnaire.eligibilityRequired && (
        <label
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm leading-relaxed transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring sm:p-5',
            deviceEligibilityConfirmed
              ? 'border-primary/40 bg-primary/5'
              : 'border-border bg-card hover:bg-muted/30',
            disabled && 'cursor-wait opacity-60',
          )}
        >
          <input
            type="checkbox"
            aria-label="ยืนยันเครื่องผ่านเงื่อนไขรับซื้อ"
            className="mt-1 size-4 shrink-0 accent-primary"
            checked={deviceEligibilityConfirmed}
            disabled={disabled}
            onChange={(event) => {
              if (!disabled) onEligibilityChange(event.target.checked);
            }}
          />
          <span className="min-w-0 space-y-2">
            <span className="block font-semibold">ตรวจเงื่อนไขรับซื้อก่อน</span>
            <span className="block text-muted-foreground">{questionnaire.eligibilityText}</span>
          </span>
        </label>
      )}
      <div className="space-y-4">
        {questionnaire.questions.map((question, index) => (
          <fieldset
            key={question.key}
            disabled={disabled}
            className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5"
            aria-describedby={`${fieldId}-${question.key}-help`}
          >
            <legend className="sr-only">{question.title}</legend>
            <div
              className="flex items-start gap-3 text-base font-semibold leading-snug"
              aria-hidden="true"
            >
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-lg text-xs',
                  answered(question)
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {answered(question) ? <Check className="size-4" aria-hidden="true" /> : index + 1}
              </span>
              <span className="min-w-0 pt-0.5">{question.title}</span>
            </div>
            <p
              id={`${fieldId}-${question.key}-help`}
              className="mb-4 mt-2 text-sm leading-snug text-muted-foreground"
            >
              {question.helpText ? `${question.helpText} · ` : ''}
              {question.selectType === 'MULTI'
                ? 'เลือกได้หลายข้อ หรือยืนยันว่าไม่พบปัญหา'
                : 'เลือก 1 ข้อตามที่ตรวจพบ'}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {question.choices.map((choice) => (
                <label
                  key={choice.id}
                  className={cn(
                    'flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm leading-snug transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring',
                    selected[question.key]?.includes(choice.id)
                      ? 'border-primary/60 bg-primary/5'
                      : 'border-input bg-background/50 hover:border-primary/40 hover:bg-muted/40',
                    disabled && 'cursor-wait opacity-60',
                  )}
                >
                  <input
                    type={question.selectType === 'SINGLE' ? 'radio' : 'checkbox'}
                    name={`${fieldId}-${question.key}`}
                    value={choice.id}
                    aria-label={choice.label}
                    checked={selected[question.key]?.includes(choice.id) ?? false}
                    onChange={() => pick(question, choice.id)}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 space-y-1 wrap-anywhere">
                    <span className="block font-medium">{choice.label}</span>
                    {choice.helpText && (
                      <span className="block text-xs leading-relaxed text-muted-foreground">
                        {choice.helpText}
                      </span>
                    )}
                  </span>
                </label>
              ))}
              {question.selectType === 'MULTI' && (
                <label
                  className={cn(
                    'flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium leading-snug transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring sm:col-span-2',
                    answered(question) && selected[question.key].length === 0
                      ? 'border-primary/60 bg-primary/5'
                      : 'border-input bg-background/50 hover:border-primary/40 hover:bg-muted/40',
                    disabled && 'cursor-wait opacity-60',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={answered(question) && selected[question.key].length === 0}
                    onChange={(event) => {
                      if (disabled) return;
                      const next = { ...selected };
                      if (event.target.checked) next[question.key] = [];
                      else delete next[question.key];
                      onChange(next);
                    }}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <span>ตรวจแล้ว ไม่พบปัญหา</span>
                </label>
              )}
            </div>
          </fieldset>
        ))}
      </div>
    </>
  );
}
