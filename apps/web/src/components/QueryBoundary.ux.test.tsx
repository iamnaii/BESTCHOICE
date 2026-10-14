import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QueryBoundary from './QueryBoundary';

describe('data state recovery', () => {
  it('distinguishes permission denied from a retryable server failure and hides stale totals', async () => {
    const retry = vi.fn();
    const view = render(
      <QueryBoundary
        isLoading={false}
        isError
        error={{ response: { status: 403 } }}
        onRetry={retry}
      >
        <p>ยอดรวม 0 บาท</p>
      </QueryBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึงข้อมูล' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ลองใหม่' })).not.toBeInTheDocument();
    expect(screen.queryByText('ยอดรวม 0 บาท')).not.toBeInTheDocument();
    view.rerender(
      <QueryBoundary
        isLoading={false}
        isError
        error={{ response: { status: 500 } }}
        onRetry={retry}
      >
        <p>ยอดรวม 0 บาท</p>
      </QueryBoundary>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByText('ยอดรวม 0 บาท')).not.toBeInTheDocument();
  });
  it('announces loading instead of rendering a zero balance', () => {
    render(
      <QueryBoundary isLoading isError={false}>
        <p>ยอดรวม 0 บาท</p>
      </QueryBoundary>,
    );
    expect(screen.getByRole('status', { name: 'กำลังโหลด' })).toBeInTheDocument();
    expect(screen.queryByText('ยอดรวม 0 บาท')).not.toBeInTheDocument();
  });
});
