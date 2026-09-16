import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { STAGE_LABELS, type JourneyStage } from '@installment/shared';
import { formatDateShort } from '@/utils/formatters';
import JourneyStageStrip from '../components/JourneyStageStrip';
import { journeySummary, stageSteps } from './journeyFixtures';

// วันที่คำนวณด้วย formatter ตัวเดียวกับหน้าจอเสมอ — CI รันเป็น UTC
// ลำดับขั้น (เจ้าของสั่ง 2026-09-15 "ต้องเช็คเครดิตก่อนนัด"): ③ ตรวจเครดิต มาก่อน ④ นัด / จอง ⇒ วันที่ตัวอย่างเรียงตามนั้น
const AT = {
  CONTACTED: '2026-08-01T03:00:00.000Z',
  IDENTIFIED: '2026-08-02T03:00:00.000Z',
  CREDIT: '2026-08-20T03:00:00.000Z',
  INTERESTED: '2026-09-01T03:00:00.000Z',
  PURCHASED: '2026-09-05T03:00:00.000Z',
};

function stepItem(stage: JourneyStage) {
  const strip = screen.getByRole('region', { name: 'ขั้นการเดินทางของลูกค้า' });
  return within(strip).getByText(STAGE_LABELS[stage]).closest('li');
}

describe('JourneyStageStrip', () => {
  it('ลำดับขั้น: ③ ตรวจเครดิต มาก่อน ④ นัด / จอง · เลขบนจุดตามตำแหน่ง (เจ้าของสั่ง 2026-09-15)', () => {
    render(<JourneyStageStrip summary={journeySummary()} />);
    const strip = screen.getByRole('region', { name: 'ขั้นการเดินทางของลูกค้า' });
    const items = within(strip).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-stage'))).toEqual(['CONTACTED', 'IDENTIFIED', 'CREDIT', 'INTERESTED', 'PURCHASED']);
    expect(STAGE_LABELS.INTERESTED).toBe('นัด / จอง');
    expect(items[2]).toHaveTextContent('ตรวจเครดิต');
    expect(within(items[2]).getByText('3')).toBeInTheDocument();
    expect(items[3]).toHaveTextContent('นัด / จอง');
    expect(within(items[3]).getByText('4')).toBeInTheDocument();
  });

  it('ซื้อเงินสดโดยไม่ตรวจเครดิต: ขั้นตรวจเครดิตเป็น "ข้าม (เงินสด)" · ซื้อแล้วเป็นขั้นปัจจุบันไม่นับวันค้าง', () => {
    render(
      <JourneyStageStrip
        summary={journeySummary({
          stage: 'PURCHASED',
          path: 'CASH',
          daysInStage: 10,
          steps: stageSteps({ CONTACTED: 'done', IDENTIFIED: 'done', CREDIT: 'skipped', INTERESTED: 'done', PURCHASED: 'current' }, AT),
        })}
      />,
    );
    expect(stepItem('CONTACTED')).toHaveAttribute('data-state', 'done');
    expect(stepItem('CONTACTED')).toHaveTextContent(formatDateShort(AT.CONTACTED));
    expect(stepItem('CREDIT')).toHaveAttribute('data-state', 'skipped');
    expect(stepItem('CREDIT')).toHaveTextContent('ข้าม (เงินสด)');
    expect(stepItem('INTERESTED')).toHaveTextContent(formatDateShort(AT.INTERESTED));
    expect(stepItem('PURCHASED')).toHaveAttribute('aria-current', 'step');
    expect(stepItem('PURCHASED')).not.toHaveTextContent('อยู่ขั้นนี้');
    expect(screen.queryByText(/^หลุด/)).toBeNull();
    expect(screen.queryByText(/^เงียบ/)).toBeNull();
  });

  it('พนักงานบันทึกนัดโดยยังไม่มีหลักฐานตรวจเครดิต: ขั้น 3 "ข้าม" · ขั้น 4 บอกวันค้าง + "พนักงานบันทึก" · ป้ายหลุดและเงียบ', () => {
    render(
      <JourneyStageStrip
        summary={journeySummary({
          stage: 'INTERESTED',
          daysInStage: 12,
          silentDays: 45,
          lost: { at: '2026-09-10T03:00:00.000Z', reason: 'BOUGHT_ELSEWHERE' },
          steps: stageSteps(
            { CONTACTED: 'done', IDENTIFIED: 'done', CREDIT: 'skipped', INTERESTED: 'current', PURCHASED: 'todo' },
            AT,
            ['INTERESTED'],
          ),
        })}
      />,
    );
    expect(stepItem('INTERESTED')).toHaveAttribute('aria-current', 'step');
    expect(stepItem('INTERESTED')).toHaveTextContent(`${formatDateShort(AT.INTERESTED)} · อยู่ขั้นนี้ 12 วัน · พนักงานบันทึก`);
    expect(stepItem('CREDIT')).toHaveAttribute('data-state', 'skipped');
    expect(stepItem('CREDIT')).toHaveTextContent('ข้าม');
    expect(stepItem('CREDIT')).not.toHaveTextContent(formatDateShort(AT.CREDIT));
    expect(stepItem('PURCHASED')).toHaveTextContent('ยังไม่ถึง');
    expect(screen.getByText('หลุด · ซื้อที่อื่น')).toBeInTheDocument();
    expect(screen.getByText('เงียบ 45 วัน')).toBeInTheDocument();
  });

  it('เครดิตไม่ผ่าน → ขั้นตรวจเครดิตบอกไม่ผ่าน · ขั้นนัด / จอง ยังไม่ถึง · เงียบไม่เกิน 30 วันไม่ติดป้าย · รหัสหลุดที่ไม่รู้จักไม่แสดงค่าดิบ', () => {
    render(
      <JourneyStageStrip
        summary={journeySummary({
          stage: 'CREDIT',
          path: 'INSTALLMENT',
          daysInStage: 4,
          creditRejected: true,
          silentDays: 20,
          lost: { at: '2026-09-10T03:00:00.000Z', reason: 'SOMETHING_NEW' },
          steps: stageSteps({ CONTACTED: 'done', IDENTIFIED: 'done', CREDIT: 'current', INTERESTED: 'todo', PURCHASED: 'todo' }, AT),
        })}
      />,
    );
    expect(stepItem('CREDIT')).toHaveTextContent(`${formatDateShort(AT.CREDIT)} · เครดิตไม่ผ่าน`);
    expect(stepItem('CREDIT')).not.toHaveTextContent('อยู่ขั้นนี้');
    expect(stepItem('INTERESTED')).toHaveAttribute('data-state', 'todo');
    expect(stepItem('INTERESTED')).toHaveTextContent('ยังไม่ถึง');
    expect(screen.queryByText(/^เงียบ/)).toBeNull();
    expect(screen.getByText('หลุด')).toBeInTheDocument();
    expect(screen.queryByText(/SOMETHING_NEW/)).toBeNull();
  });
});
