import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VoucherPdfPreview from './VoucherPdfPreview';

describe('VoucherPdfPreview', () => {
  afterEach(() => vi.restoreAllMocks());

  it('downloads the displayed PDF with its Thai filename and retains it until the preview closes', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:voucher');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const blob = new Blob(['%PDF-example'], { type: 'application/pdf' });
    const filename = 'ใบสำคัญจ่ายเงิน_EXP-20260900008.pdf';
    const { unmount } = render(
      <VoucherPdfPreview blob={blob} filename={filename} onClose={vi.fn()} />,
    );
    const download = await screen.findByRole('link', { name: 'ดาวน์โหลด PDF' });
    expect(download).toHaveAttribute('download', filename);
    expect(download).toHaveAttribute('href', 'blob:voucher');
    expect(screen.getByTitle(filename)).toHaveAttribute('src', 'blob:voucher#toolbar=0&view=FitH');
    expect(create).toHaveBeenCalledWith(blob);
    expect(revoke).not.toHaveBeenCalled();
    unmount();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:voucher'));
  });
});
