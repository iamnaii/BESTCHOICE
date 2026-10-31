import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { emptyAddress } from '@/components/ui/AddressForm';
import { CustomerCreateModal } from './CustomerCreateModal';
import { emptyCustForm, emptyCustReference } from '../constants';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  getErrorMessage: () => 'error',
}));

/**
 * Task 27 — ทำสัญญา › เพิ่มลูกค้าใหม่: ช่อง "LINE ID (Finance / น้องเบส)" ถูกแทนด้วยหมายเหตุเต็มความกว้าง (mockup CreateCustomer)
 * · LINE ร้านยังพิมพ์ได้
 */
describe('CustomerCreateModal — LINE น้องเบส (การเงิน)', () => {
  it('ไม่มีช่องพิมพ์ LINE การเงิน · มีหมายเหตุวิธีที่ลูกค้าผูกเอง · LINE ร้านยังแก้ได้', () => {
    render(
      <CustomerCreateModal
        isOpen
        onClose={vi.fn()}
        custForm={emptyCustForm}
        setCustForm={vi.fn()}
        custAddrIdCard={emptyAddress}
        setCustAddrIdCard={vi.fn()}
        custAddrCurrent={emptyAddress}
        setCustAddrCurrent={vi.fn()}
        custSameAddress={false}
        setCustSameAddress={vi.fn()}
        custAddrWork={emptyAddress}
        setCustAddrWork={vi.fn()}
        custReferences={[emptyCustReference]}
        updateCustRef={vi.fn()}
        createCustomerMutation={{ mutate: vi.fn(), isPending: false }}
        handleSmartCardForModal={vi.fn()}
        cardReaderLoading={false}
      />,
    );
    expect(screen.queryByLabelText(/LINE ID \(Finance/)).not.toBeInTheDocument();
    expect(screen.getByRole('note', { name: 'LINE น้องเบส (การเงิน)' })).toHaveTextContent(
      'ไม่ต้องกรอก ลูกค้าผูกเองหลังสร้างเสร็จ: ส่งข้อความใดก็ได้ในแชท LINE น้องเบส แล้วกดปุ่ม “เริ่มยืนยันตัวตน” กรอกเบอร์และรหัส OTP ทาง SMS',
    );
    expect(screen.getByLabelText('LINE ID (Shop / ร้าน)')).toBeEnabled();
  });
});
