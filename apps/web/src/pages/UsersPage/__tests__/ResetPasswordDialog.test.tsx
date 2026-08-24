import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ResetPasswordDialog from '../components/ResetPasswordDialog';
import { MIN_PASSWORD_LENGTH } from '../types';

/**
 * prod 2026-08-24: /users ไม่มีทางรีเซ็ตรหัสผ่านให้พนักงานเลย (เมนูมีแค่ แก้ไข /
 * ปิดใช้งาน) เจ้าของจึงหาไม่เจอ. dialog นี้คือทางนั้น — และต้องกันรหัสสั้น/พิมพ์ไม่ตรง
 * ตั้งแต่ฝั่งหน้าจอ เพราะ API ตีกลับ 400 เฉย ๆ เมื่อสั้นกว่า MIN_PASSWORD_LENGTH
 */

const USER = { id: 'u1', name: 'สมชาย ใจดี', email: 'somchai@bestchoice.com' };

const onSubmit = vi.fn();
const onClose = vi.fn();

const longEnough = 'a'.repeat(MIN_PASSWORD_LENGTH);
const tooShort = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);

function setup(user: typeof USER | null = USER, isPending = false) {
  return render(
    <ResetPasswordDialog user={user} isPending={isPending} onClose={onClose} onSubmit={onSubmit} />,
  );
}

const passwordInput = () => screen.getByLabelText('รหัสผ่านใหม่ *');
const confirmInput = () => screen.getByLabelText('ยืนยันรหัสผ่านใหม่ *');
const submitButton = () => screen.getByRole('button', { name: 'ตั้งรหัสผ่านใหม่' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ResetPasswordDialog', () => {
  it('ปิดอยู่เมื่อยังไม่ได้เลือกผู้ใช้', () => {
    setup(null);
    expect(screen.queryByText('รีเซ็ตรหัสผ่าน')).not.toBeInTheDocument();
  });

  it('บอกชื่อ + อีเมลของคนที่กำลังจะถูกรีเซ็ต', () => {
    setup();
    expect(screen.getByText(/สมชาย ใจดี/)).toBeInTheDocument();
    expect(screen.getByText(/somchai@bestchoice.com/)).toBeInTheDocument();
  });

  it('ยังกดไม่ได้เมื่อรหัสสั้นกว่าเกณฑ์', () => {
    setup();
    fireEvent.change(passwordInput(), { target: { value: tooShort } });
    fireEvent.change(confirmInput(), { target: { value: tooShort } });
    expect(submitButton()).toBeDisabled();
  });

  it('ยังกดไม่ได้เมื่อยืนยันไม่ตรง + ขึ้นข้อความบอก', () => {
    setup();
    fireEvent.change(passwordInput(), { target: { value: longEnough } });
    fireEvent.change(confirmInput(), { target: { value: `${longEnough}x` } });
    expect(screen.getByText('รหัสผ่านไม่ตรงกัน')).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it('ส่งรหัสผ่านออกไปเมื่อครบเงื่อนไข', () => {
    setup();
    fireEvent.change(passwordInput(), { target: { value: longEnough } });
    fireEvent.change(confirmInput(), { target: { value: longEnough } });
    fireEvent.click(submitButton());
    expect(onSubmit).toHaveBeenCalledWith(longEnough);
  });

  it('ล้างช่องรหัสเมื่อสลับไปรีเซ็ตให้คนอื่น — กันรหัสของคนก่อนหน้าค้าง', () => {
    const { rerender } = setup();
    fireEvent.change(passwordInput(), { target: { value: longEnough } });
    expect(passwordInput()).toHaveValue(longEnough);

    rerender(
      <ResetPasswordDialog
        user={{ id: 'u2', name: 'สมหญิง', email: 'somying@bestchoice.com' }}
        isPending={false}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );
    expect(passwordInput()).toHaveValue('');
  });
});
