import { act, render, screen, waitFor } from '@testing-library/react';
import { type ReactElement, useEffect, useState } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ScrollToTop } from './ScrollToTop';

/** หน้าที่วาด section ปลายทางช้ากว่า effect ของ ScrollToTop — แทนหน้าแบบ lazy */
function LateRatesPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(t);
  }, []);
  return ready ? <section id="rates">อัตราผ่อน</section> : <p>กำลังโหลด</p>;
}

function RatesPage() {
  return (
    <>
      <Link to="/how-it-works#rates">ไปที่เรท</Link>
      <section id="rates">อัตราผ่อน</section>
    </>
  );
}

function renderAt(url: string, page: ReactElement) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ScrollToTop />
      <Routes>
        <Route path="/how-it-works" element={page} />
        <Route path="/products" element={<Link to="/how-it-works">วิธีผ่อน</Link>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ScrollToTop', () => {
  let scrollIntoView: Mock<Element['scrollIntoView']>;
  let scrollTo: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scrollIntoView = vi.fn<Element['scrollIntoView']>();
    Element.prototype.scrollIntoView = scrollIntoView;
    scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  afterEach(() => {
    scrollTo.mockRestore();
  });

  it('เปิดลิงก์ที่มี #rates ตรง ๆ — รอให้ section วาดเสร็จแล้วเลื่อนไปหา', async () => {
    renderAt('/how-it-works#rates', <LateRatesPage />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    await screen.findByText('อัตราผ่อน');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
  });

  it('กดลิงก์ #rates บนหน้าที่ section มีอยู่แล้ว — เลื่อนไปหาเลย ไม่กระโดดขึ้นบนก่อน', async () => {
    renderAt('/how-it-works', <RatesPage />);
    scrollIntoView.mockClear();
    scrollTo.mockClear();
    await act(async () => screen.getByText('ไปที่เรท').click());
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('เปลี่ยนหน้าแบบไม่มี #hash — เลื่อนขึ้นบนสุดตามเดิม', async () => {
    renderAt('/products', <RatesPage />);
    await act(async () => screen.getByText('วิธีผ่อน').click());
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
