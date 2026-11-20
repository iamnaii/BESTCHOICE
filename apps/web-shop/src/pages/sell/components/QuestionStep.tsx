import type { BuybackQuestion } from '@/types/buyback';
import { Button } from '@/components';
import ChoiceButton from './ChoiceButton';
const bodyDrawings: Record<string, string> = {
  ไม่มีรอยขีดข่วน: '',
  'มีรอยนิดหน่อย รอยเคส': 'M12 20l4-4',
  'มีรอยมาก ถลอก สีหลุด': 'M12 20l4-4M20 28l5-5M14 35l5-5',
  'ตัวเครื่องมีรอยตก / เบี้ยว / แตก / งอ': 'M9 14l5 6-5 6M26 33l-5 5',
  'ฝาหลัง / กระจกหลังแตก': 'M18 9l-4 14 8 6-7 15M14 23l-6 8M22 29l7 4',
};
export default function QuestionStep({
  question,
  answer,
  showIssues,
  disabled,
  onSingle,
  onNone,
  onToggleIssue,
  onShowIssues,
  onConfirmIssues,
}: {
  question: BuybackQuestion;
  answer: string[] | undefined;
  showIssues: boolean;
  disabled: boolean;
  onSingle: (id: string) => void;
  onNone: () => void;
  onToggleIssue: (id: string) => void;
  onShowIssues: () => void;
  onConfirmIssues: () => void;
}) {
  const multi = question.selectType === 'MULTI';
  const body = question.key === 'body-condition';
  const warrantyGap =
    question.key === 'warranty' &&
    question.choices.some((c) => c.label === 'ประกันเหลือมากกว่า 4 เดือน') &&
    question.choices.some((c) => c.label === 'ประกันเหลือน้อยกว่า 4 เดือน');
  return (
    <div className="space-y-4">
      {question.helpText && <p className="text-sm break-words">{question.helpText}</p>}
      {warrantyGap && <p className="text-sm">ถ้าเหลือประกันพอดี 4 เดือน ให้สอบถามร้านก่อนเลือก</p>}
      {body && <p className="text-sm">ภาพเป็นตัวอย่างคร่าว ๆ ให้เลือกตามข้อความ</p>}
      {!multi && <p className="text-sm">แตะคำตอบแล้วไปต่อได้เลย · ย้อนกลับมาแก้ได้</p>}
      {multi && (
        <div className="grid gap-2">
          <ChoiceButton
            selected={answer?.length === 0 && !showIssues}
            disabled={disabled}
            onClick={onNone}
          >
            ใช้งานได้ปกติทุกอย่าง
          </ChoiceButton>
          <ChoiceButton selected={showIssues} disabled={disabled} onClick={onShowIssues}>
            มีอาการผิดปกติ
          </ChoiceButton>
        </div>
      )}
      {(!multi || showIssues) && (
        <div className="grid gap-2" role="group" aria-label={question.title}>
          {question.choices
            .filter((choice) => !choice.isNoneChoice)
            .map((choice) => (
              <ChoiceButton
                key={choice.id}
                label={choice.label}
                multiple={multi}
                selected={answer?.includes(choice.id) ?? false}
                disabled={disabled}
                onClick={() => (multi ? onToggleIssue(choice.id) : onSingle(choice.id))}
              >
                <span className="flex items-center gap-3">
                  {body && Object.hasOwn(bodyDrawings, choice.label) && (
                    <svg
                      aria-hidden="true"
                      width="36"
                      height="50"
                      viewBox="0 0 36 50"
                      className="shrink-0 text-secondary-foreground"
                    >
                      <rect
                        x="6"
                        y="3"
                        width="24"
                        height="44"
                        rx="5"
                        fill="none"
                        stroke="currentColor"
                      />
                      <circle cx="12" cy="10" r="2" fill="none" stroke="currentColor" />
                      <path d={bodyDrawings[choice.label]} stroke="currentColor" fill="none" />
                    </svg>
                  )}
                  <span>
                    {choice.label}
                    {choice.helpText && (
                      <span className="mt-1 block text-sm">{choice.helpText}</span>
                    )}
                    {/sensor|เซนเซอร์/i.test(choice.label) && (
                      <span className="mt-1 block text-sm">ไม่แน่ใจให้สอบถามร้านก่อนเลือก</span>
                    )}
                  </span>
                </span>
              </ChoiceButton>
            ))}
        </div>
      )}
      {multi && showIssues && (
        <div className="space-y-2">
          <p className="text-sm">
            {answer?.length
              ? 'เลือกได้หลายอาการ เมื่อครบแล้วกดยืนยัน'
              : 'เลือกอย่างน้อย 1 อาการ หรือเลือกใช้งานได้ปกติทุกอย่าง'}
          </p>
          <Button
            fullWidth
            size="lg"
            disabled={disabled || !answer?.length}
            onClick={onConfirmIssues}
          >
            ยืนยันอาการ
          </Button>
        </div>
      )}
    </div>
  );
}
