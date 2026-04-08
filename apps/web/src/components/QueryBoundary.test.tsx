import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QueryBoundary from './QueryBoundary';

describe('<QueryBoundary />', () => {
  it('renders the children when not loading and not errored', () => {
    render(
      <QueryBoundary isLoading={false} isError={false}>
        <span>data is here</span>
      </QueryBoundary>,
    );
    expect(screen.getByText('data is here')).toBeInTheDocument();
  });

  it('shows a spinner (role=status) when isLoading is true', () => {
    render(
      <QueryBoundary isLoading={true} isError={false}>
        <span>data is here</span>
      </QueryBoundary>,
    );
    expect(screen.getByRole('status', { name: 'กำลังโหลด' })).toBeInTheDocument();
    expect(screen.queryByText('data is here')).not.toBeInTheDocument();
  });

  it('shows a custom loading fallback when one is provided', () => {
    render(
      <QueryBoundary
        isLoading={true}
        isError={false}
        loadingFallback={<div data-testid="skeleton">loading…</div>}
      >
        <span>data is here</span>
      </QueryBoundary>,
    );
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the error title + message when isError is true', () => {
    const err = new Error('เครือข่ายขัดข้อง');
    render(
      <QueryBoundary isLoading={false} isError={true} error={err}>
        <span>data is here</span>
      </QueryBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('ไม่สามารถโหลดข้อมูลได้')).toBeInTheDocument();
    expect(screen.getByText('เครือข่ายขัดข้อง')).toBeInTheDocument();
    expect(screen.queryByText('data is here')).not.toBeInTheDocument();
  });

  it('honours a custom errorTitle and errorMessage', () => {
    render(
      <QueryBoundary
        isLoading={false}
        isError={true}
        errorTitle="โหลดรายชื่อลูกค้าไม่สำเร็จ"
        errorMessage="ลองใหม่ในอีกสักครู่"
      >
        <span>irrelevant</span>
      </QueryBoundary>,
    );
    expect(screen.getByText('โหลดรายชื่อลูกค้าไม่สำเร็จ')).toBeInTheDocument();
    expect(screen.getByText('ลองใหม่ในอีกสักครู่')).toBeInTheDocument();
  });

  it('shows a retry button when onRetry is provided and invokes it on click', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <QueryBoundary isLoading={false} isError={true} onRetry={onRetry}>
        <span>irrelevant</span>
      </QueryBoundary>,
    );
    const btn = screen.getByRole('button', { name: /ลองใหม่/ });
    await user.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('hides the retry button when onRetry is not provided', () => {
    render(
      <QueryBoundary isLoading={false} isError={true}>
        <span>irrelevant</span>
      </QueryBoundary>,
    );
    expect(screen.queryByRole('button', { name: /ลองใหม่/ })).not.toBeInTheDocument();
  });

  it('falls back to a generic Thai message when error is not an Error instance', () => {
    render(
      <QueryBoundary isLoading={false} isError={true} error={'raw string'}>
        <span>irrelevant</span>
      </QueryBoundary>,
    );
    expect(
      screen.getByText('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์'),
    ).toBeInTheDocument();
  });
});
