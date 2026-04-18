import React from 'react';
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

function Boom(): React.ReactNode {
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

  it('auto-reloads on "Failed to fetch dynamically imported module" (stale bundle after deploy)', () => {
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    // @ts-expect-error — jsdom's location is non-configurable; replace via delete+assign
    delete window.location;
    // @ts-expect-error — reassigning window.location with a stub for the test
    window.location = { ...originalLocation, reload: reloadSpy };
    sessionStorage.clear();

    function ChunkBoom(): React.ReactNode {
      throw new Error(
        'Failed to fetch dynamically imported module: https://example.com/assets/Foo-abc.js',
      );
    }

    render(
      <ErrorBoundary>
        <ChunkBoom />
      </ErrorBoundary>,
    );

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    // Sentry should NOT be called when we choose to auto-reload — the reload
    // is the recovery path, not a reportable crash.
    expect(captureExceptionMock).not.toHaveBeenCalled();

    // @ts-expect-error — restore original location after test
    window.location = originalLocation;
    sessionStorage.clear();
  });

  it('does not reload twice in a row (cooldown prevents infinite loop)', () => {
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    // @ts-expect-error — jsdom's location is non-configurable; replace via delete+assign
    delete window.location;
    // @ts-expect-error — reassigning window.location with a stub for the test
    window.location = { ...originalLocation, reload: reloadSpy };
    // Pretend we already reloaded 1 second ago.
    sessionStorage.setItem('bc:chunk-load-reload-at', String(Date.now() - 1000));

    function ChunkBoom(): React.ReactNode {
      throw new Error('Failed to fetch dynamically imported module: /assets/X.js');
    }

    render(
      <ErrorBoundary>
        <ChunkBoom />
      </ErrorBoundary>,
    );

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(screen.getByText('เกิดข้อผิดพลาด')).toBeInTheDocument();
    // Fall-through means Sentry still gets notified.
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);

    // @ts-expect-error — restore original location after test
    window.location = originalLocation;
    sessionStorage.clear();
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
