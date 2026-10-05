import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import BookingDetailSheet from '../components/BookingDetailSheet';
import { describeEvent } from '../components/BookingTimeline';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  booking: {} as Record<string, unknown>,
  detailError: false,
  role: 'SALES' as string,
}));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.delete },
  getErrorMessage: (e: Error) => e.message,
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: mocks.role, branchId: 'br-1' } }),
}));

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="loc">{loc.pathname + loc.search}</output>;
}
function renderSheet(props: Partial<React.ComponentProps<typeof BookingDetailSheet>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(
    <MemoryRouter initialEntries={['/bookings?bookingId=bk-1']}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <LocationProbe />
                <BookingDetailSheet
                  bookingId="bk-1"
                  canMutate
                  canDelete={false}
                  canAcknowledgeDamage={false}
                  onClose={onClose}
                  onChanged={onChanged}
                  {...props}
                />
              </>
            }
          />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { onClose, onChanged };
}
const dialog = async () => {
  const d = await screen.findByRole('dialog');
  await screen.findByText('BK-20261005-0002');
  return d;
};
const convertBtn = () =>
  screen.getByRole('button', { name: /รับส่วนต่าง .* และออกใบขาย|ออกใบขายโดยใช้มัดจำ/ });

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.detailError = false;
  mocks.role = 'SALES';
  mocks.booking = {
    id: 'bk-1',
    bookingNumber: 'BK-20261005-0002',
    status: 'PAID',
    depositAmount: '1000',
    totalAmount: '10000',
    expireDate: '2099-09-11T17:00:00.000Z',
    depositPaidAt: '2026-10-05T03:55:00Z',
    depositMethod: 'CASH',
    createdAt: '2026-10-05T03:42:00Z',
    customer: { id: 'c1', name: 'ลูกค้าตัวอย่าง', phone: '0800000000' },
    branch: { id: 'br-1', name: 'สาขาตัวอย่าง', shopCashAccountCode: 'S11-1101' },
    createdBy: { id: 'u1', name: 'พนักงานตัวอย่าง' },
    items: [
      {
        id: 'i1',
        productId: 'p1',
        description: 'เครื่องตัวอย่าง',
        quantity: 1,
        unitPrice: '10000',
        amount: '10000',
        product: {
          id: 'p1',
          name: 'เครื่องตัวอย่าง',
          status: 'IN_STOCK',
          branchId: 'br-1',
          imeiSerial: 'SYNTHETIC-IMEI',
        },
      },
    ],
    events: [
      {
        id: 'e1',
        kind: 'BOOKING_CREATED',
        at: '2026-10-05T03:42:00Z',
        actor: { id: 'u1', name: 'พนักงานตัวอย่าง' },
        data: {},
      },
      {
        id: 'e2',
        kind: 'BOOKING_DEPOSIT_PAID',
        at: '2026-10-05T03:55:00Z',
        actor: { id: 'u1', name: 'พนักงานตัวอย่าง' },
        data: { depositMethod: 'CASH' },
      },
    ],
  };
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/bookings/bk-1') {
      if (mocks.detailError) throw new Error('Synthetic offline');
      return { data: mocks.booking };
    }
    if (path === '/branches') return { data: [{ id: 'br-1', name: 'สาขาตัวอย่าง' }] };
    return { data: [] };
  });
  mocks.post.mockResolvedValue({ data: { sale: { id: 'sale-1' }, bookingId: 'bk-1' } });
  mocks.delete.mockResolvedValue({ data: { id: 'bk-1' } });
});

describe('BookingDetailSheet', () => {
  it('มัดจำบางส่วน: ต้องเลือกวิธี+เลขอ้างอิง+ติ๊กยืนยัน แล้วส่ง convert พร้อม tender · สำเร็จแล้วพาไปใบขาย', async () => {
    renderSheet();
    await dialog();
    expect(convertBtn()).toBeDisabled();
    expect(screen.getByText(/คงเหลือที่ต้องรับวันนี้/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('วิธีรับเงิน'), 'BANK_TRANSFER');
    await userEvent.click(
      screen.getByRole('checkbox', { name: /ยืนยันว่าได้รับยอดส่วนต่างครบแล้ว/ }),
    );
    expect(convertBtn()).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/เลขอ้างอิงการโอน/), 'SYNTHETIC-REF');
    await userEvent.click(convertBtn());
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/bookings/bk-1/convert',
        expect.objectContaining({
          collectBalance: true,
          paymentMethod: 'BANK_TRANSFER',
          saleType: 'CASH',
          tenders: [{ method: 'BANK_TRANSFER', amount: 9000, reference: 'SYNTHETIC-REF' }],
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('loc')).toHaveTextContent('/sales?saleId=sale-1'),
    );
  });

  it('มัดจำเต็มจำนวน: ไม่ขอรับส่วนต่าง ปุ่ม "ออกใบขายโดยใช้มัดจำ" ส่ง collectBalance/paymentMethod เป็น undefined', async () => {
    mocks.booking.depositAmount = '10000';
    renderSheet();
    await dialog();
    expect(screen.queryByLabelText('วิธีรับเงิน')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ออกใบขายโดยใช้มัดจำ' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/bookings/bk-1/convert',
        expect.objectContaining({ paymentMethod: undefined, collectBalance: undefined }),
      ),
    );
  });

  it('รอชำระมัดจำ: ช่องรับเงินบอกบัญชี SHOP ตามวิธี และส่ง pay-deposit พร้อม tender', async () => {
    Object.assign(mocks.booking, {
      status: 'PENDING_DEPOSIT',
      depositPaidAt: null,
      depositMethod: null,
    });
    renderSheet();
    await dialog();
    expect(screen.getByText(/รับเข้าบัญชี SHOP/)).toHaveTextContent('S11-1101');
    await userEvent.selectOptions(screen.getByLabelText('วิธีรับเงิน'), 'BANK_TRANSFER');
    expect(screen.getByText(/รับเข้าบัญชี SHOP/)).toHaveTextContent('S11-1201');
    const pay = screen.getByRole('button', { name: /บันทึกรับมัดจำ/ });
    expect(pay).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/เลขอ้างอิงการโอน/), 'SYNTHETIC-REF');
    await userEvent.click(pay);
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/bookings/bk-1/pay-deposit', {
        depositMethod: 'BANK_TRANSFER',
        tenders: [{ method: 'BANK_TRANSFER', amount: 1000, reference: 'SYNTHETIC-REF' }],
      }),
    );
  });

  it('ยกเลิกจากเมนู ⋯ ต้องผ่านกล่องยืนยัน + เหตุผล ≥ 3 ตัวอักษร แล้วส่ง cancel', async () => {
    const { onChanged } = renderSheet();
    await dialog();
    await userEvent.click(screen.getByRole('button', { name: 'การกระทำเพิ่มเติม' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /ยกเลิกใบจอง/ }));
    const confirm = await screen.findByRole('dialog', { name: /ยกเลิกใบจอง/ });
    expect(confirm).toHaveTextContent('คืนมัดจำ 1,000');
    const yes = within(confirm).getByRole('button', { name: /ยืนยันยกเลิกและคืนมัดจำ 1,000/ });
    expect(yes).toBeDisabled();
    const chip = within(confirm).getByRole('button', { name: 'ลูกค้าเปลี่ยนใจ' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(within(confirm).getByRole('button', { name: 'ไม่ผ่านเครดิต' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(yes).toBeEnabled();
    await userEvent.click(yes);
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/bookings/bk-1/cancel', {
        cancelReason: 'ลูกค้าเปลี่ยนใจ',
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('ใบเดิมที่มีหลายรายการ: บอกว่าแปลงขายไม่ได้ และปุ่มหลักปิด', async () => {
    mocks.booking.items = [
      {
        id: 'i1',
        description: 'รายการเดิม',
        quantity: 2,
        productId: 'p1',
        unitPrice: 5000,
        amount: 10000,
      },
    ];
    renderSheet();
    await dialog();
    expect(screen.getByRole('alert')).toHaveTextContent('1 รายการ จำนวน 1 ชิ้น');
    expect(
      screen.queryByRole('button', { name: /รับส่วนต่าง .* และออกใบขาย|ออกใบขายโดยใช้มัดจำ/ }),
    ).not.toBeInTheDocument();
  });

  describe('เครื่องไม่พร้อม (B2) — ปุ่มเงินปิด + ข้อความชี้ทางที่ทำได้จริง', () => {
    const withProduct = (patch: Record<string, unknown>) => {
      const items = mocks.booking.items as Array<{ product: Record<string, unknown> }>;
      items[0].product = { ...items[0].product, ...patch };
    };
    const pending = () =>
      Object.assign(mocks.booking, {
        status: 'PENDING_DEPOSIT',
        depositPaidAt: null,
        depositMethod: null,
      });

    it('ควบคุม: เครื่องพร้อมขาย → ปุ่มรับมัดจำกดได้ ไม่มี alert', async () => {
      pending();
      renderSheet();
      await dialog();
      expect(screen.getByRole('button', { name: /บันทึกรับมัดจำ/ })).toBeEnabled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    it('ใบ PAID ที่ล็อกเครื่องของตัวเอง (RESERVED + lockedProductId ตรง) → ป้าย "ล็อกไว้ให้ลูกค้ารายนี้แล้ว" และปุ่มแปลงขายเปิด', async () => {
      // มัดจำเต็มยอด → ปุ่ม "ออกใบขายโดยใช้มัดจำ" ไม่ต้องรับส่วนต่าง จึงสะท้อนเฉพาะสถานะเครื่อง
      Object.assign(mocks.booking, { depositAmount: '10000', lockedProductId: 'p1' });
      withProduct({ status: 'RESERVED' });
      renderSheet();
      await dialog();
      expect(screen.getByText('ล็อกไว้ให้ลูกค้ารายนี้แล้ว')).toBeInTheDocument();
      expect(convertBtn()).toBeEnabled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    it('ใบ PAID ที่เครื่องเป็น RESERVED ของคนอื่น (lockedProductId ว่าง) → ยังเป็น "มีคนอื่นถือเครื่องอยู่" และปุ่มเงินปิด', async () => {
      mocks.booking.lockedProductId = null;
      withProduct({ status: 'RESERVED' });
      renderSheet();
      await dialog();
      expect(screen.getAllByText(/มีคนอื่นถือเครื่องอยู่/).length).toBeGreaterThan(0);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(convertBtn()).toBeDisabled();
    });
    it('ใบ PENDING + เครื่อง IN_STOCK → "พร้อมขาย · จะล็อกเมื่อรับมัดจำ"', async () => {
      pending();
      renderSheet();
      await dialog();
      expect(screen.getByText('พร้อมขาย · จะล็อกเมื่อรับมัดจำ')).toBeInTheDocument();
    });
    it('RESERVED (คนอื่นถืออยู่) + รอมัดจำ: ปุ่มรับมัดจำปิด · alert ชี้ "แก้ไขใบจอง → เปลี่ยนเครื่อง"', async () => {
      pending();
      withProduct({ status: 'RESERVED' });
      renderSheet();
      await dialog();
      expect(screen.getByRole('button', { name: /บันทึกรับมัดจำ/ })).toBeDisabled();
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('มีคนอื่นถือเครื่องอยู่ (จอง/สัญญาร่าง)');
      expect(alert).toHaveTextContent('แก้ไขใบจอง → เปลี่ยนเครื่อง');
    });
    it('เครื่องย้ายสาขา + มัดจำแล้ว: ปุ่มแปลงขายปิด · alert ชี้ "ยกเลิกใบจองเพื่อคืนมัดจำ"', async () => {
      withProduct({ branchId: 'br-2' });
      renderSheet();
      await dialog();
      expect(convertBtn()).toBeDisabled();
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('เครื่องย้ายสาขาไปแล้ว');
      expect(alert).toHaveTextContent('ยกเลิกใบจองเพื่อคืนมัดจำ');
    });
    it('ไม่ผูกเครื่อง + มัดจำแล้ว: ปุ่มแปลงขายปิด + alert · ไม่ผูกเครื่อง + รอมัดจำ: ปุ่มรับมัดจำปิด', async () => {
      mocks.booking.items = [
        {
          id: 'i1',
          description: 'รายการเดิม',
          quantity: 1,
          productId: null,
          unitPrice: 10000,
          amount: 10000,
        },
      ];
      renderSheet();
      await dialog();
      expect(convertBtn()).toBeDisabled();
      expect(screen.getByRole('alert')).toHaveTextContent('ยกเลิกใบจองเพื่อคืนมัดจำ');
    });
    it('ไม่ผูกเครื่อง + รอมัดจำ → ปุ่มรับมัดจำปิด + alert ชี้เมนูแก้ไข', async () => {
      pending();
      mocks.booking.items = [
        {
          id: 'i1',
          description: 'รายการเดิม',
          quantity: 1,
          productId: null,
          unitPrice: 10000,
          amount: 10000,
        },
      ];
      renderSheet();
      await dialog();
      expect(screen.getByRole('button', { name: /บันทึกรับมัดจำ/ })).toBeDisabled();
      expect(screen.getByRole('alert')).toHaveTextContent('แก้ไขใบจอง → เปลี่ยนเครื่อง');
    });
    it('รอมัดจำ + หลายรายการ (แก้ไขไม่ได้) → alert ไม่ชี้เมนูแก้ไข แต่ชี้ "ยกเลิกใบจองแล้วสร้างใหม่"', async () => {
      pending();
      withProduct({ status: 'RESERVED' });
      mocks.booking.items = [
        ...(mocks.booking.items as unknown[]),
        {
          id: 'i2',
          description: 'รายการที่สอง',
          quantity: 1,
          productId: 'p2',
          unitPrice: 1000,
          amount: 1000,
        },
      ];
      renderSheet();
      await dialog();
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('ยกเลิกใบจองแล้วสร้างใหม่');
      expect(alert).not.toHaveTextContent('แก้ไขใบจอง');
    });
    it('ใบที่ปิดแล้ว (เครื่องถูกขาย) ไม่ขึ้น alert ปุ่มเงิน — แค่ป้ายสถานะเครื่อง', async () => {
      Object.assign(mocks.booking, { status: 'CANCELED', canceledAt: '2026-10-05T05:00:00Z' });
      withProduct({ status: 'SOLD_CASH' });
      renderSheet();
      await dialog();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('ไทม์ไลน์/แผงใช้ปฏิทินไทย: เหตุการณ์ 00:30 ไทย (17:30Z) = 6 ต.ค. 69 00:30 ไม่ว่า TZ เครื่อง', async () => {
    (mocks.booking.events as Array<Record<string, unknown>>).push({
      id: 'e9',
      kind: 'BOOKING_UPDATED',
      at: '2026-10-05T17:30:00Z',
      actor: { id: 'u1', name: 'พนักงานตัวอย่าง' },
      data: { changed: ['notes'] },
    });
    renderSheet();
    await dialog();
    expect(screen.getByText(/6 ต\.ค\. 69 00:30 · พนักงานตัวอย่าง/)).toBeInTheDocument();
  });

  it('หมดอายุแล้ว (ริบมัดจำ): แถบบอกวันสุดท้ายตามปฏิทินไทย + ยอดริบ', async () => {
    Object.assign(mocks.booking, { status: 'EXPIRED', expireDate: '2026-10-05T17:00:00.000Z' });
    renderSheet();
    await dialog();
    expect(screen.getByText(/หมดอายุสิ้นวัน 5 ต\.ค\. 69 · ริบมัดจำ 1,000/)).toBeInTheDocument();
  });

  it('เลยกำหนดแต่ cron ยังไม่ปิด: ป้าย "รอระบบปิด" ปุ่มเงินหาย มีปุ่มโหลดสถานะล่าสุด', async () => {
    mocks.booking.expireDate = '2000-01-01T17:00:00.000Z';
    renderSheet();
    await dialog();
    expect(screen.getByRole('status')).toHaveTextContent('รอระบบปิด');
    expect(screen.queryByRole('button', { name: /ออกใบขาย|รับส่วนต่าง/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'โหลดสถานะล่าสุด' })).toBeEnabled();
  });

  it('โหลดรายละเอียดล้ม → แจ้งพร้อมปุ่มลองใหม่ ไม่ค้าง "กำลังโหลด"', async () => {
    mocks.detailError = true;
    renderSheet();
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดใบจองไม่สำเร็จ');
    expect(screen.queryByText('กำลังโหลด...')).not.toBeInTheDocument();
    mocks.detailError = false;
    await userEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(await screen.findByText('BK-20261005-0002')).toBeInTheDocument();
  });

  it('บทบาทอ่านอย่างเดียว: ไม่มีช่องรับเงิน ไม่มีเมนู ⋯ แต่เห็นไทม์ไลน์และเครื่อง', async () => {
    renderSheet({ canMutate: false });
    await dialog();
    expect(screen.queryByLabelText('วิธีรับเงิน')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'การกระทำเพิ่มเติม' })).not.toBeInTheDocument();
    expect(screen.getByText('รับมัดจำ · เงินสด')).toBeInTheDocument();
    expect(screen.getByText(/พร้อมขาย · ยังอยู่ในสต็อก/)).toBeInTheDocument();
  });

  it('ขายแล้ว: แถบบอกเลขใบขาย + ปุ่มเปิดใบขาย และไม่มีเมนู ⋯', async () => {
    Object.assign(mocks.booking, {
      status: 'CONVERTED',
      convertedAt: '2026-10-01T07:20:00Z',
      convertedToSale: { id: 'sale-9', saleNumber: 'SL-20261001-0004' },
    });
    renderSheet();
    await dialog();
    await userEvent.click(screen.getByRole('button', { name: /เปิดใบขาย/ }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/sales?saleId=sale-9');
    expect(screen.queryByRole('button', { name: 'การกระทำเพิ่มเติม' })).not.toBeInTheDocument();
  });
});

describe('describeEvent', () => {
  it('แปลง AuditLog เป็นข้อความไทย', () => {
    expect(
      describeEvent({
        id: '1',
        kind: 'BOOKING_CANCELED',
        at: '',
        actor: null,
        data: { refundAmount: '5000.00', cancelReason: 'ลูกค้าเปลี่ยนใจ' },
      }).title,
    ).toBe('ยกเลิกใบจอง · คืนมัดจำ 5,000 · ลูกค้าเปลี่ยนใจ');
    expect(
      describeEvent({
        id: '2',
        kind: 'BOOKING_AUTO_EXPIRED',
        at: '',
        actor: null,
        data: { forfeitAmount: '3000.00' },
      }).title,
    ).toBe('หมดอายุ · ริบมัดจำ 3,000');
    expect(
      describeEvent({
        id: '3',
        kind: 'BOOKING_UPDATED',
        at: '',
        actor: null,
        data: { changed: ['notes', 'expireDate'] },
      }).title,
    ).toBe('แก้ไข หมายเหตุ · วันหมดอายุ');
  });
});
