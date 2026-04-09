import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from './ErrorBoundary';

const captureExceptionMock = vi.fn();
const withScopeMock = vi.fn();

vi.mock('@sentry/react', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  withScope: (cb: (scope: {
    setTag: (k: string, v: string) => void;
    setExtras: (e: Record<string, unknown>) => void;
  }) => void) => {
    const scope = {
      setTag: vi.fn(),
      setExtras: vi.fn(),
    };
    cb(scope);
    withScopeMock(scope);
  },
}));

function Boom(): JSX.Element {
  throw new Error('boom 💥');
}

describe('<ErrorBoundary />', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captureExceptionMock.mockReset();
    withScopeMock.mockReset();
    // React logs the caught error to console.error; silence it for clean output.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div data-testid="ok">OK</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('ok')).toBeInTheDocument();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('renders the Thai fallback when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('เกิดข้อผิดพลาด')).toBeInTheDocument();
    expect(screen.getByText('boom 💥')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ลองใหม่' })).toBeInTheDocument();
  });

  it('reports the thrown error to Sentry.captureException', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [reportedError] = captureExceptionMock.mock.calls[0];
    expect(reportedError).toBeInstanceOf(Error);
    expect((reportedError as Error).message).toBe('boom 💥');
  });

  it('tags the Sentry scope with error.boundary=root', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    // withScope was called exactly once when the error fired.
    expect(withScopeMock).toHaveBeenCalledTimes(1);
    const scope = withScopeMock.mock.calls[0][0];
    expect(scope.setTag).toHaveBeenCalledWith('error.boundary', 'root');
    expect(scope.setExtras).toHaveBeenCalledWith(
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
  });

  it('resets and re-renders children after "ลองใหม่" is clicked', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('เกิดข้อผิดพลาด')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    // Now feed in harmless children — boundary should recover.
    rerender(
      <ErrorBoundary>
        <div data-testid="recovered">recovered</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('recovered')).toBeInTheDocument();
  });
});
