import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RoomCreditCard from './RoomCreditCard';
import type { RoomCreditModel } from '../hooks/useRoomCredit';

const model = (result?: Record<string, unknown>): RoomCreditModel => ({
  roomId: 'room',
  files: [
    {
      id: 'f',
      roomId: 'room',
      name: 'Statement.pdf',
      size: 1000,
      mimeType: 'application/pdf',
      sourceMessageId: 'm',
      url: '/staff-chat/rooms/room/credit-check/files/f',
    },
  ],
  analysis: result
    ? { id: 'a', fileIds: ['f'], status: 'COMPLETED', result, createdAt: '2026-09-07T00:00:00Z' }
    : null,
  busy: false,
  analyzing: false,
  loading: false,
  error: null,
  upload: vi.fn(),
  toggleMessage: vi.fn(),
  remove: vi.fn(),
  analyze: vi.fn(),
  retry: vi.fn(),
});

describe('room credit card', () => {
  it('opens the customer credit history tab directly from a completed statement', () => {
    render(<RoomCreditCard credit={model({ affordablePayment: 3000 })} customerId="customer" />);
    fireEvent.click(screen.getByRole('button', { name: 'ดูรายละเอียด' }));
    expect(screen.getByRole('link', { name: 'เปิดประวัติตรวจเครดิตของลูกค้า' })).toHaveAttribute(
      'href',
      '/customers/customer?tab=credit',
    );
  });
  it('only analyzes on an explicit button click, even when files are attached', () => {
    const credit = model();
    render(<RoomCreditCard credit={credit} customerId={null} />);
    expect(credit.analyze).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'AI วิเคราะห์ (1 ไฟล์)' }));
    expect(credit.analyze).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/ไฟล์และผลจะเก็บไว้กับห้องนี้/)).toBeInTheDocument();
  });
  it('shows figures without score, confidence, approval or a password field', () => {
    render(
      <RoomCreditCard
        credit={model({
          affordablePayment: 3000,
          monthlyIncome: 10000,
          aiScore: 99,
          confidence: 0.99,
          recommendation: 'ผ่าน',
        })}
        customerId={null}
      />,
    );
    expect(screen.getByText('ผ่อนไหวเดือนละ')).toBeInTheDocument();
    expect(screen.getByText('3,000')).toBeInTheDocument();
    expect(screen.queryByText(/99|คะแนน|ความมั่นใจ|ผ่าน/)).toBeNull();
    expect(document.querySelector('input[type=password]')).toBeNull();
  });
  it('disables changes during analysis and hides obsolete results after file changes', () => {
    const credit = { ...model({ affordablePayment: 3000 }), busy: true, analyzing: true };
    const view = render(<RoomCreditCard credit={credit} customerId={null} />);
    expect(screen.queryByRole('button', { name: /เอา Statement 1 ออก/ })).toBeNull();
    expect(screen.queryByText('3,000')).toBeNull();
    view.rerender(
      <RoomCreditCard
        credit={{ ...model({ affordablePayment: 3000 }), files: [] }}
        customerId={null}
      />,
    );
    expect(screen.queryByText('3,000')).toBeNull();
  });
  it('labels positive and risk factors and offers a copyable request for a locked file', () => {
    const view = render(
      <RoomCreditCard
        credit={model({
          positiveFactors: ['รายได้สม่ำเสมอ'],
          riskFactors: ['เงินออกสูง'],
          monthlyIncome: 10000,
        })}
        customerId={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ดูรายละเอียด' }));
    expect(screen.getByText('ปัจจัยบวก')).toBeInTheDocument();
    expect(screen.getByText('ปัจจัยเสี่ยง')).toBeInTheDocument();
    view.rerender(
      <RoomCreditCard
        credit={{ ...model(), error: 'เปิดไฟล์นี้ไม่ได้ — ไฟล์นี้ล็อกรหัส' }}
        customerId={null}
      />,
    );
    expect(screen.getByRole('button', { name: 'คัดลอกข้อความขอไฟล์ใหม่' })).toBeInTheDocument();
  });
});
