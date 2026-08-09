import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AiRuntimeStatusStrip } from './AiSettingsPage';

// pattern เดียวกับ page test เดิมของ repo (เช่น CannedResponseAdminPage.test.tsx:7-23):
// import หน้าเพจเข้ามาจะลาก `@/lib/api` (axios + interceptor) และ `sonner` ตามมาด้วย
// ถึงจะ render แค่ component ย่อยก็ตาม — mock ไว้ให้เป็นมาตรฐานเดียวกัน
vi.mock('@/lib/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: {} }), patch: vi.fn(), post: vi.fn() },
  getErrorMessage: (e: any) => e?.message ?? 'error',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('AiRuntimeStatusStrip', () => {
  it('เตือนเมื่อบอท Facebook ถูกปิดด้วย env', () => {
    render(
      <AiRuntimeStatusStrip
        status={{
          fbBotDisabled: true,
          fbWhitelistCount: 2,
          centralBranchSet: true,
          promptpaySet: true,
          tiktokAdapterStub: true,
          financeBotSeparatePipeline: true,
        }}
      />,
    );
    expect(screen.getByText(/บอท Facebook ปิดอยู่/)).toBeTruthy();
    expect(screen.getByText(/2/)).toBeTruthy();
  });

  it('เตือนเมื่อยังไม่ได้ตั้งสาขาศูนย์กลาง (บอทจะไม่ตอบช่องร้านค้าเลย)', () => {
    render(
      <AiRuntimeStatusStrip
        status={{
          fbBotDisabled: false,
          fbWhitelistCount: 0,
          centralBranchSet: false,
          promptpaySet: false,
          tiktokAdapterStub: true,
          financeBotSeparatePipeline: true,
        }}
      />,
    );
    expect(screen.getByText(/ยังไม่ได้ตั้งสาขาศูนย์กลาง/)).toBeTruthy();
  });

  it('ทุกอย่างพร้อม → ไม่มีข้อความเตือนสีแดง', () => {
    const { container } = render(
      <AiRuntimeStatusStrip
        status={{
          fbBotDisabled: false,
          fbWhitelistCount: 0,
          centralBranchSet: true,
          promptpaySet: true,
          tiktokAdapterStub: true,
          financeBotSeparatePipeline: true,
        }}
      />,
    );
    expect(container.querySelectorAll('[data-status="warn"]')).toHaveLength(0);
  });
});
