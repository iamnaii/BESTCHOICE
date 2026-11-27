import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import ShopFooter from '@/components/layout/ShopFooter';
import { __resetConsentForTest, getConsentState, saveConsent } from '@/lib/consent';
import ConsentUi from './ConsentUi';
import { useConsentUi } from './useConsentUi';
import { MARKETING_ROW_TEXT } from './vendors';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function setup() {
  return render(
    <MemoryRouter>
      <ConsentUi />
      <ShopFooter />
    </MemoryRouter>,
  );
}

const banner = () => screen.queryByRole('region', { name: 'การใช้คุกกี้' });

describe('แบนเนอร์คุกกี้', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetConsentForTest();
    useConsentUi.setState({ settingsOpen: false });
    vi.mocked(toast.success).mockClear();
  });
  afterEach(() => {
    delete window.__BC_PRERENDER__;
    window.localStorage.clear();
    __resetConsentForTest();
  });

  it('ขึ้นเมื่อยังไม่เลือก', () => {
    setup();
    expect(banner()).toBeInTheDocument();
    expect(banner()).toHaveAttribute('data-consent-ui');
    expect(screen.getByText('เว็บไซต์นี้ใช้คุกกี้')).toBeInTheDocument();
  });

  it('ไม่ขึ้นเมื่อเลือกแล้ว', () => {
    saveConsent({ analytics: false, marketing: false });
    setup();
    expect(banner()).not.toBeInTheDocument();
  });

  it('ไม่ render อะไรเลยตอน prerender', () => {
    window.__BC_PRERENDER__ = true;
    const { container } = setup();
    expect(banner()).not.toBeInTheDocument();
    expect(container.querySelector('[data-consent-ui]')).toBeNull();
    act(() => useConsentUi.getState().openSettings());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ยอมรับทั้งหมด', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'ยอมรับทั้งหมด' }));
    expect(getConsentState()).toMatchObject({ analytics: true, marketing: true, decided: true });
    expect(banner()).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('บันทึกการตั้งค่าคุกกี้แล้ว');
  });

  it('ปฏิเสธ', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'ปฏิเสธ' }));
    expect(getConsentState()).toMatchObject({ analytics: false, marketing: false, decided: true });
    expect(banner()).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('บันทึกการตั้งค่าคุกกี้แล้ว');
  });

  it('ตั้งค่า เปิดหน้าต่างโดยสวิตช์ปิดทั้งคู่ และยังไม่บันทึกอะไร', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'ตั้งค่า' }));
    const dialog = screen.getByRole('dialog', { name: 'ตั้งค่าคุกกี้' });
    expect(dialog).toHaveAttribute('data-consent-ui');
    expect(screen.getByRole('switch', { name: 'คุกกี้เพื่อการวิเคราะห์' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: 'คุกกี้เพื่อการตลาด' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(getConsentState().decided).toBe(false);
  });

  it('ข้อความหน้าต่างตรงกับที่อนุมัติ', () => {
    useConsentUi.setState({ settingsOpen: true });
    setup();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/และการนับจำนวนผู้เข้าชมของร้าน/)).toBeInTheDocument();
    expect(MARKETING_ROW_TEXT).toBe(
      'ใช้วัดผลโฆษณา และแสดงโฆษณาของร้านที่ตรงกับความสนใจของคุณบน Facebook และ Instagram',
    );
    expect(within(dialog).getByText(MARKETING_ROW_TEXT)).toBeInTheDocument();
    expect(within(dialog).queryByText(/TikTok|LINE/)).toBeNull();
  });

  it('เปิดจากลิงก์ท้ายหน้า แสดงค่าปัจจุบัน และบันทึกที่เลือก', () => {
    saveConsent({ analytics: true, marketing: false });
    setup();
    expect(banner()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ตั้งค่าคุกกี้' }));
    const analytics = screen.getByRole('switch', { name: 'คุกกี้เพื่อการวิเคราะห์' });
    const marketing = screen.getByRole('switch', { name: 'คุกกี้เพื่อการตลาด' });
    expect(analytics).toHaveAttribute('aria-checked', 'true');
    expect(marketing).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(analytics);
    fireEvent.click(marketing);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกที่เลือก' }));

    expect(getConsentState()).toMatchObject({ analytics: false, marketing: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('บันทึกการตั้งค่าคุกกี้แล้ว');
  });

  it('ปิดหน้าต่างโดยไม่บันทึก = ไม่เปลี่ยนอะไร และเปิดใหม่เริ่มจากค่าจริง', () => {
    saveConsent({ analytics: true, marketing: true });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'ตั้งค่าคุกกี้' }));
    fireEvent.click(screen.getByRole('switch', { name: 'คุกกี้เพื่อการวิเคราะห์' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(getConsentState()).toMatchObject({ analytics: true, marketing: true });
    fireEvent.click(screen.getByRole('button', { name: 'ตั้งค่าคุกกี้' }));
    expect(screen.getByRole('switch', { name: 'คุกกี้เพื่อการวิเคราะห์' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('ปฏิเสธทั้งหมด / ยอมรับทั้งหมด ในหน้าต่าง', () => {
    saveConsent({ analytics: true, marketing: true });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'ตั้งค่าคุกกี้' }));
    fireEvent.click(screen.getByRole('button', { name: 'ปฏิเสธทั้งหมด' }));
    expect(getConsentState()).toMatchObject({ analytics: false, marketing: false });
    expect(toast.success).toHaveBeenCalledWith('บันทึกการตั้งค่าคุกกี้แล้ว');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ตั้งค่าคุกกี้' }));
    fireEvent.click(screen.getByRole('button', { name: 'ยอมรับทั้งหมด' }));
    expect(getConsentState()).toMatchObject({ analytics: true, marketing: true });
    expect(toast.success).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenLastCalledWith('บันทึกการตั้งค่าคุกกี้แล้ว');
  });

  it('แบนเนอร์ตั้ง --cookie-banner-offset ระหว่างแสดง และลบเมื่อเลือกแล้ว', () => {
    const root = document.documentElement;
    setup();
    expect(root.style.getPropertyValue('--cookie-banner-offset')).not.toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'ปฏิเสธ' }));
    expect(root.style.getPropertyValue('--cookie-banner-offset')).toBe('');
  });

  it('ท้ายหน้าไม่มี data-consent-ui และมีลิงก์นโยบาย', () => {
    saveConsent({ analytics: false, marketing: false });
    const { container } = render(
      <MemoryRouter>
        <ShopFooter />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-consent-ui]')).toBeNull();
    expect(screen.getByRole('link', { name: 'นโยบายความเป็นส่วนตัว' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });
});
