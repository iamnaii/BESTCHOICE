import { useState } from 'react';
import type { BuybackQuestion } from '@installment/shared';
import { buybackSourceName } from '@installment/shared';

export interface ReferenceQuestionnaireCatalog {
  source: string;
  capturedAt: string;
  assignments: Array<{ model: string; storage: string; profileId: string }>;
  profiles: Record<string, { questions: BuybackQuestion[]; eligibilityText: string }>;
}

/** Read-only source profiles: changing a global question must not appear to edit these rates. */
export default function ReferenceQuestionnaire({
  catalog,
}: {
  catalog: ReferenceQuestionnaireCatalog;
}) {
  const [selection, setSelection] = useState('');
  const assignments = catalog.assignments;
  const active =
    assignments.find((entry) => `${entry.model}|${entry.storage}` === selection) ?? assignments[0];
  const profile = active ? catalog.profiles[active.profileId] : undefined;

  return (
    <section className="space-y-4" aria-label="เงื่อนไขอ้างอิงรายรุ่น">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border bg-card p-4">
        <div className="space-y-1 text-sm leading-relaxed">
          <h3 className="font-semibold">แบบตรวจ iPhone ตามรุ่นและความจุ</h3>
          <p className="text-muted-foreground">
            อ้างอิง {buybackSourceName(catalog.source)} · ข้อมูล ณ {new Date(catalog.capturedAt).toLocaleDateString('th-TH')}
          </p>
          <p className="text-muted-foreground">
            รวมค่าหักเป็นบาท แล้วใช้เปอร์เซ็นต์หักที่สูงที่สุดจากผลตรวจทั้งหมด
          </p>
        </div>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">รุ่นและความจุ</span>
          <select
            className="min-h-11 max-w-full rounded-lg border border-input bg-background px-3"
            value={active ? `${active.model}|${active.storage}` : ''}
            onChange={(event) => setSelection(event.target.value)}
          >
            {assignments.map((entry) => (
              <option
                key={`${entry.model}|${entry.storage}`}
                value={`${entry.model}|${entry.storage}`}
              >
                {entry.model} · {entry.storage}
              </option>
            ))}
          </select>
        </label>
      </div>
      {profile && (
        <>
          <p className="rounded-lg border border-border p-4 text-sm leading-relaxed">
            <strong>เงื่อนไขก่อนรับซื้อ: </strong>
            {profile.eligibilityText}
          </p>
          <div className="grid gap-4 xl:grid-cols-2">
            {profile.questions.map((question) => (
              <section
                key={question.key}
                className="min-w-0 overflow-hidden rounded-lg border border-border"
              >
                <h4 className="bg-muted/50 px-4 py-3 font-medium">{question.title}</h4>
                <dl className="divide-y divide-border text-sm">
                  {question.choices.map((choice) => (
                    <div
                      key={choice.id}
                      className="flex items-start justify-between gap-4 px-4 py-3"
                    >
                      <dt className="min-w-0 space-y-1 wrap-anywhere">
                        <span className="block">{choice.label}</span>
                        {choice.helpText && (
                          <span className="block text-xs leading-relaxed text-muted-foreground">
                            {choice.helpText}
                          </span>
                        )}
                      </dt>
                      <dd className="shrink-0 font-medium tabular-nums">
                        {Number(choice.deductValue) === 0
                          ? 'ไม่หัก'
                          : `${Number(choice.deductValue).toLocaleString('th-TH')}${choice.deductType === 'PERCENT' ? '%' : ' บาท'}`}
                      </dd>
                    </div>
                  ))}
                  {question.selectType === 'MULTI' && (
                    <div className="flex justify-between gap-4 px-4 py-3">
                      <dt>ตรวจแล้ว ไม่พบปัญหา</dt>
                      <dd>ไม่หัก</dd>
                    </div>
                  )}
                </dl>
              </section>
            ))}
          </div>
        </>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        ข้อมูลอ้างอิงชุดนี้ใช้กับรุ่นและความจุที่แสดง
        การแก้แบบตรวจทั่วไปไม่มีผลกับค่าหักในชุดอ้างอิง ใบเสนอเดิมเก็บผลตรวจและราคา ณ เวลาที่ประเมิน
      </p>
    </section>
  );
}
