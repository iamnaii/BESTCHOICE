import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReceiptVoidDialog from '../ReceiptVoidDialog';

const captured = vi.hoisted(() => ({ props: {} as Record<string, any> }));
vi.mock('@/components/payment/PaymentApprovalRequestDialog', () => ({
  default: (props: Record<string, any>) => {
    captured.props = props;
    return props.open ? <div><p>{props.description}</p><button onClick={() => { props.onRequested({ id: 'request-1', status: 'PENDING' }); props.onOpenChange(false); }}>ส่งคำขอ</button><button onClick={() => props.onOpenChange(false)}>ปิด</button></div> : null;
  },
}));
function wrap(ui: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
}
beforeEach(() => { vi.clearAllMocks(); captured.props = {}; });
describe('ReceiptVoidDialog — approval request', () => {
  it('requests the selected receipt and explains that every sibling will be voided', () => {
    render(wrap(<ReceiptVoidDialog receiptId="r-1" receiptNumber="RT-202609-00007" onClose={vi.fn()} />));
    expect(captured.props.action).toBe('VOID_RECEIPT');
    expect(captured.props.targetId).toBe('r-1');
    expect(captured.props.payload).toEqual({});
    expect(screen.getByText(/RT-202609-00007/)).toHaveTextContent('ใบเสร็จอื่นของงวดเดียวกัน');
  });
  it('closes after requesting without pretending that the receipt has already been voided', () => {
    const onClose=vi.fn(), onVoided=vi.fn();
    render(wrap(<ReceiptVoidDialog receiptId="r-1" onClose={onClose} onVoided={onVoided} />));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งคำขอ' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onVoided).not.toHaveBeenCalled();
  });
  it('closes without an action and stays hidden when no receipt is selected', () => {
    const onClose=vi.fn();
    const result=render(wrap(<ReceiptVoidDialog receiptId="r-1" onClose={onClose} />));
    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }));
    expect(onClose).toHaveBeenCalledOnce();
    result.rerender(wrap(<ReceiptVoidDialog receiptId={null} onClose={onClose} />));
    expect(screen.queryByRole('button', { name: 'ส่งคำขอ' })).not.toBeInTheDocument();
  });
});
