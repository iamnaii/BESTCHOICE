import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import App from './App';

/**
 * Task 19 — `/liff/register` (ผูก LINE การเงินด้วยเบอร์อย่างเดียว ไม่มี OTP) ถูกปิด
 * URL เดิมยังต้องใช้ได้ (ลิงก์ในหน้า LIFF / ข้อความ OA / ค่า Endpoint ใน LINE Developers อาจชี้มา)
 * ⇒ ต้องพาไป `/liff/finance-verify` (เบอร์ + OTP SMS) โดยคง query + hash ไว้ทั้งหมด —
 * hash/query ของ LINE Login callback (`line_login=true` · `#id_token=`) และ `src=` ของแคมเปญต้องไม่หาย
 *
 * เรนเดอร์ <App/> จริง (ตาราง route ตัวเดียวกับที่ใช้งาน) โดย mock แค่ AuthContext และหน้าปลายทาง
 */
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false, isLoading: false }),
}));

vi.mock('@/pages/liff/LiffFinanceVerify', async () => {
  const { useLocation } = await import('react-router');
  return {
    default: function FinanceVerifyProbe() {
      const { pathname, search, hash } = useLocation();
      return <div data-testid="finance-verify">{`${pathname}|${search}|${hash}`}</div>;
    },
  };
});

describe('/liff/register → /liff/finance-verify (Task 19)', () => {
  it('redirects to the OTP verification page, preserving query string and hash', async () => {
    render(
      <MemoryRouter initialEntries={['/liff/register?src=sms1&lineId=U123#id_token=abc']}>
        <App />
      </MemoryRouter>,
    );

    const probe = await screen.findByTestId('finance-verify');
    expect(probe.textContent).toBe('/liff/finance-verify|?src=sms1&lineId=U123|#id_token=abc');
  });

  it('bare /liff/register (LIFF endpoint / rich menu) lands on the verification page too', async () => {
    render(
      <MemoryRouter initialEntries={['/liff/register']}>
        <App />
      </MemoryRouter>,
    );

    expect((await screen.findByTestId('finance-verify')).textContent).toBe(
      '/liff/finance-verify||',
    );
  });
});
