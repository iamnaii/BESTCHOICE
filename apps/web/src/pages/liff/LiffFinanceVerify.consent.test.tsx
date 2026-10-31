import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LiffFinanceVerify from './LiffFinanceVerify';

/**
 * Task 33 (mockup C1–C3 "ยินยอมตอนผูก" ที่เจ้าของอนุมัติ — แบบบังคับ) — ถ้อยคำตาม `C1Phone/C2Otp/C2bOtpWrong/C3Success.dc.html`:
 * C1 ติ๊กยินยอม (จำเป็น) ไม่ติ๊ก = ปุ่ม "ส่งรหัส OTP" disabled จริง + เหตุผลใต้ปุ่ม · C2 ความยินยอมติดไปกับขั้น OTP (กด "เปลี่ยนเบอร์" ติ๊กยังอยู่) ·
 * verify-otp ส่ง `consent: true` · C2b รหัสผิดแปลงข้อความ API "OTP ไม่ถูกต้อง (เหลือ N ครั้ง)" (N จากระบบจริง) · C3 วันที่บันทึกความยินยอมจาก API
 */
const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/hooks/useLiffInit', () => ({
  useLiffInit: () => ({
    lineId: 'U-test',
    profile: { userId: 'U-test', displayName: 'ทดสอบ LINE' },
    loading: false,
    error: null,
  }),
}));
vi.mock('@/lib/api', () => ({ liffApi: { get, post } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const CONSENT_LABEL =
  'ยินยอมให้บริษัทส่งแจ้งเตือนค่างวด ใบเสร็จ และข้อมูลสัญญาทาง LINE (จำเป็น)';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LiffFinanceVerify />
    </QueryClientProvider>,
  );
}

async function fillPhone() {
  renderPage();
  fireEvent.change(await screen.findByLabelText(/เบอร์โทรศัพท์/), { target: { value: '0812345678' } });
}

async function goToOtp() {
  await fillPhone();
  fireEvent.click(screen.getByRole('checkbox', { name: CONSENT_LABEL }));
  fireEvent.click(screen.getByRole('button', { name: 'ส่งรหัส OTP' }));
  await screen.findByText('089-***-5678');
}

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: { linked: false } });
  post.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/request-otp')) return { data: { maskedPhone: '089-***-5678', expiresInSeconds: 300 } };
    return {
      data: {
        customerId: 'c-1',
        customerName: 'สมชาย ใจดี',
        consentRecordedAt: '2026-10-31T03:00:00.000Z',
      },
    };
  });
});

describe('C1 — ขั้นที่ 1 จาก 2: กรอกเบอร์ + ยินยอม (บังคับ)', () => {
  it('บอกขั้นเป็นคำ · ช่องเบอร์มีป้าย (จำเป็น) · ช่องติ๊กยินยอมยังไม่ติ๊ก · ลิงก์นโยบายความเป็นส่วนตัว', async () => {
    renderPage();
    expect(await screen.findByText('ขั้นที่ 1 จาก 2')).toBeInTheDocument();
    expect(screen.getByText('· กรอกเบอร์และยินยอม', { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText(/เบอร์โทรศัพท์/)).toHaveAttribute('type', 'tel');
    expect(screen.getByRole('checkbox', { name: CONSENT_LABEL })).not.toBeChecked();
    const link = screen.getByRole('link', { name: /อ่านนโยบายความเป็นส่วนตัว/ });
    expect(link).toHaveAttribute('href', '/privacy');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('ไม่ติ๊ก → ปุ่ม "ส่งรหัส OTP" disabled จริง (แม้กรอกเบอร์ครบ) + เหตุผลใต้ปุ่ม · ไม่ยิง API', async () => {
    await fillPhone();
    const button = screen.getByRole('button', { name: 'ส่งรหัส OTP' });
    expect(button).toBeDisabled();
    const reason = screen.getByText('ติ๊กยินยอมด้านบนก่อน จึงจะส่งรหัส OTP ได้');
    expect(button.getAttribute('aria-describedby')).toBe(reason.closest('[id]')!.id);
    fireEvent.click(button);
    expect(post).not.toHaveBeenCalled();
  });

  it('ติ๊กแล้ว → ปุ่มกดได้ · เหตุผลหาย · ส่งรหัสไปเบอร์ที่กรอก', async () => {
    await fillPhone();
    fireEvent.click(screen.getByRole('checkbox', { name: CONSENT_LABEL }));
    expect(screen.queryByText('ติ๊กยินยอมด้านบนก่อน จึงจะส่งรหัส OTP ได้')).toBeNull();
    const button = screen.getByRole('button', { name: 'ส่งรหัส OTP' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(post).toHaveBeenCalledWith('/chatbot/finance/liff/request-otp', { phone: '0812345678' });
  });
});

describe('C2 — ขั้นที่ 2 จาก 2: ยืนยันรหัส OTP', () => {
  it('ช่องรหัสมีป้าย · เติมรหัสจาก SMS ได้ (one-time-code + แป้นตัวเลข) · นับถอยหลังขอรหัสใหม่ · สรุปความยินยอม', async () => {
    await goToOtp();
    expect(screen.getByText('ขั้นที่ 2 จาก 2')).toBeInTheDocument();
    const input = screen.getByLabelText('รหัส OTP 6 หลัก');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByRole('button', { name: /ขอรหัสใหม่ได้ในอีก 1:00/ })).toBeDisabled();
    expect(screen.getByText('ยินยอมรับแจ้งเตือนทาง LINE แล้ว')).toBeInTheDocument();
    expect(screen.getByText('ระบบจะบันทึกความยินยอมเมื่อยืนยันรหัสสำเร็จ')).toBeInTheDocument();
    expect(screen.getByText(/ไม่ได้รับ SMS ภายใน 2 นาที\? ตรวจเบอร์ด้านบน หรือโทรหาสาขา 063-134-6356/)).toBeInTheDocument();
  });

  it('ยืนยัน → verify-otp ส่ง consent: true คู่กับรหัส', async () => {
    await goToOtp();
    fireEvent.change(screen.getByLabelText('รหัส OTP 6 หลัก'), { target: { value: '482913' } });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    await screen.findByText('ผูก LINE เรียบร้อย');
    expect(post).toHaveBeenLastCalledWith('/chatbot/finance/liff/verify-otp', {
      otp: '482913',
      consent: true,
    });
  });

  it('"เปลี่ยนเบอร์" กลับขั้น 1 โดยติ๊กยินยอมยังอยู่', async () => {
    await goToOtp();
    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนเบอร์' }));
    expect(await screen.findByText('ขั้นที่ 1 จาก 2')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: CONSENT_LABEL })).toBeChecked();
    expect(screen.getByRole('button', { name: 'ส่งรหัส OTP' })).toBeEnabled();
  });

  it('นับถอยหลังครบ → ปุ่ม "ขอรหัสใหม่" กดได้', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await goToOtp();
      for (let i = 0; i < 61; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1_000);
        });
      }
      expect(await screen.findByRole('button', { name: 'ขอรหัสใหม่' })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('C2b — รหัส OTP ไม่ถูกต้อง', () => {
  it('ข้อความจาก API "OTP ไม่ถูกต้อง (เหลือ N ครั้ง)" → "รหัสไม่ถูกต้อง · เหลือลองได้อีก N ครั้ง" + ทางแก้ · ยังไม่บันทึกความยินยอม', async () => {
    await goToOtp();
    post.mockRejectedValueOnce({ response: { data: { message: 'OTP ไม่ถูกต้อง (เหลือ 1 ครั้ง)' } } });
    const input = screen.getByLabelText('รหัส OTP 6 หลัก');
    fireEvent.change(input, { target: { value: '111111' } });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('รหัสไม่ถูกต้อง · เหลือลองได้อีก 1 ครั้ง');
    expect(alert).toHaveTextContent('ตรวจรหัสจาก SMS ล่าสุดแล้วพิมพ์ทับได้เลย หรือกด “ขอรหัสใหม่”');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
    expect(screen.getByText('ยังไม่บันทึก — จะบันทึกเมื่อยืนยันรหัสสำเร็จ')).toBeInTheDocument();
  });

  it('ข้อความอื่นจาก API (ผิดครบ/หมดอายุ/หน้าเก่าไม่มีความยินยอม — รวมแบบ array) แสดงตามจริง', async () => {
    await goToOtp();
    post.mockRejectedValueOnce({
      response: { data: { message: ['ใส่ OTP ผิดครบ 3 ครั้งแล้ว — ขอรหัสใหม่ได้ในอีก 4 นาที'] } },
    });
    fireEvent.change(screen.getByLabelText('รหัส OTP 6 หลัก'), { target: { value: '111111' } });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ใส่ OTP ผิดครบ 3 ครั้งแล้ว — ขอรหัสใหม่ได้ในอีก 4 นาที',
    );
  });
});

describe('C3 — ผูก LINE เรียบร้อย', () => {
  it('ชื่อ · วันที่บันทึกความยินยอมจาก API · วิธีถอนความยินยอม (เบอร์สาขาเดิมของหน้านี้) · ลิงก์นโยบาย · ปุ่มกลับไปแชท', async () => {
    await goToOtp();
    fireEvent.change(screen.getByLabelText('รหัส OTP 6 หลัก'), { target: { value: '482913' } });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));

    const status = await screen.findByRole('status');
    expect(within(status).getByRole('heading', { name: 'ผูก LINE เรียบร้อย' })).toBeInTheDocument();
    expect(status).toHaveTextContent('คุณสมชาย ใจดี');
    expect(status).toHaveTextContent(
      'LINE นี้จะได้รับแจ้งเตือนค่างวด ใบเสร็จ และข้อมูลสัญญาของคุณ และสอบถามน้องเบสได้แล้ว',
    );
    expect(status).toHaveTextContent('บันทึกความยินยอมแล้ว');
    expect(status).toHaveTextContent(
      'เมื่อ 31/10/2569 · ยินยอมให้ส่งแจ้งเตือนค่างวด ใบเสร็จ และข้อมูลสัญญาทาง LINE',
    );
    expect(status).toHaveTextContent('ต้องการยกเลิกความยินยอม');
    expect(status).toHaveTextContent('ติดต่อเจ้าหน้าที่ทางแชทนี้ หรือโทรหาสาขา 063-134-6356');
    expect(within(status).getByRole('link', { name: /อ่านนโยบายความเป็นส่วนตัว/ })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(screen.getByRole('button', { name: 'กลับไปแชท' })).toBeInTheDocument();
  });
});
