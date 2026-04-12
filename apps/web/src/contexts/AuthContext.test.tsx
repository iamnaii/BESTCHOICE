import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthContext';

// ── Sentry mock ──────────────────────────────────────────────
const setUserMock = vi.fn();
vi.mock('@sentry/react', () => ({
  setUser: (...args: unknown[]) => setUserMock(...args),
}));

// ── api client mock ──────────────────────────────────────────
const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
const setAccessTokenMock = vi.fn();
const getAccessTokenMock = vi.fn();

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => apiGetMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
  },
  setAccessToken: (...args: unknown[]) => setAccessTokenMock(...args),
  getAccessToken: (...args: unknown[]) => getAccessTokenMock(...args),
}));

// ── Harness component that exposes the context to tests ────
function Harness() {
  const { user, isAuthenticated, isLoading, login, logout } = useAuth();
  return (
    <div>
      <div data-testid="loading">{isLoading ? 'loading' : 'done'}</div>
      <div data-testid="auth">{isAuthenticated ? 'yes' : 'no'}</div>
      <div data-testid="user">{user ? `${user.id}:${user.role}` : 'none'}</div>
      <button
        type="button"
        onClick={() => {
          void login('alice@example.com', 'pw');
        }}
      >
        login
      </button>
      <button type="button" onClick={() => void logout()}>
        logout
      </button>
    </div>
  );
}

const renderHarness = () =>
  render(
    <AuthProvider>
      <Harness />
    </AuthProvider>,
  );

beforeEach(() => {
  apiGetMock.mockReset();
  apiPostMock.mockReset();
  setAccessTokenMock.mockReset();
  getAccessTokenMock.mockReset();
  setUserMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('<AuthProvider />', () => {
  describe('initial session restore', () => {
    it('stays unauthenticated when /auth/me fails (no valid session)', async () => {
      getAccessTokenMock.mockReturnValue(null);
      // AuthContext always calls /auth/me (refresh cookie may exist).
      // Simulate 401 — no valid session.
      apiGetMock.mockRejectedValueOnce({ response: { status: 401 } });

      renderHarness();

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('done');
      });
      expect(screen.getByTestId('auth')).toHaveTextContent('no');
      expect(apiGetMock).toHaveBeenCalledWith('/auth/me', { timeout: 10000 });
    });

    it('restores the user via /auth/me and tags Sentry when a token exists', async () => {
      getAccessTokenMock.mockReturnValue('token-abc');
      apiGetMock.mockResolvedValueOnce({
        data: {
          id: 'user-1',
          email: 'alice@example.com',
          name: 'Alice',
          role: 'OWNER',
          branchId: 'branch-1',
          branch: { name: 'Main' },
        },
      });

      renderHarness();

      await waitFor(() => {
        expect(screen.getByTestId('auth')).toHaveTextContent('yes');
      });
      expect(screen.getByTestId('user')).toHaveTextContent('user-1:OWNER');
      expect(apiGetMock).toHaveBeenCalledWith(
        '/auth/me',
        expect.objectContaining({ timeout: 10000 }),
      );
      // Sentry should know who's logged in — but NOT get email or name.
      expect(setUserMock).toHaveBeenCalledWith({
        id: 'user-1',
        role: 'OWNER',
        branchId: 'branch-1',
      });
    });

    it('logs the user out when /auth/me returns 401', async () => {
      getAccessTokenMock.mockReturnValue('stale-token');
      apiGetMock.mockRejectedValueOnce({ response: { status: 401 } });
      apiPostMock.mockResolvedValueOnce({ data: {} }); // logout call

      renderHarness();

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('done');
      });
      expect(screen.getByTestId('auth')).toHaveTextContent('no');
      expect(setAccessTokenMock).toHaveBeenCalledWith(null);
      expect(setUserMock).toHaveBeenCalledWith(null);
    });

    it('keeps the session on a network error from /auth/me', async () => {
      getAccessTokenMock.mockReturnValue('token-abc');
      // No response object → network error / timeout
      apiGetMock.mockRejectedValueOnce({ code: 'ECONNABORTED' });

      renderHarness();

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('done');
      });
      // We did NOT force a logout — token might still be valid.
      expect(setAccessTokenMock).not.toHaveBeenCalled();
      expect(screen.getByTestId('auth')).toHaveTextContent('no');
    });
  });

  describe('login', () => {
    it('stores the token, sets the user, and propagates to Sentry on success', async () => {
      getAccessTokenMock.mockReturnValue(null);
      apiPostMock.mockResolvedValueOnce({
        data: {
          accessToken: 'new-token',
          user: {
            id: 'user-2',
            email: 'bob@example.com',
            name: 'Bob',
            role: 'SALES',
            branchId: 'branch-2',
            branch: { name: 'Ladprao' },
          },
        },
      });

      renderHarness();
      await waitFor(() =>
        expect(screen.getByTestId('loading')).toHaveTextContent('done'),
      );

      await userEvent.click(screen.getByText('login'));

      await waitFor(() => {
        expect(screen.getByTestId('auth')).toHaveTextContent('yes');
      });
      expect(setAccessTokenMock).toHaveBeenCalledWith('new-token');
      expect(screen.getByTestId('user')).toHaveTextContent('user-2:SALES');
      expect(setUserMock).toHaveBeenCalledWith({
        id: 'user-2',
        role: 'SALES',
        branchId: 'branch-2',
      });
    });

    it('retries login once on a network error and succeeds the second time', async () => {
      getAccessTokenMock.mockReturnValue(null);
      apiPostMock
        .mockRejectedValueOnce({ code: 'ECONNREFUSED' })
        .mockResolvedValueOnce({
          data: {
            accessToken: 'retry-token',
            user: {
              id: 'user-3',
              email: 'c@example.com',
              name: 'C',
              role: 'BRANCH_MANAGER',
              branchId: 'branch-3',
            },
          },
        });

      renderHarness();
      await waitFor(() =>
        expect(screen.getByTestId('loading')).toHaveTextContent('done'),
      );

      await userEvent.click(screen.getByText('login'));

      await waitFor(() => {
        expect(screen.getByTestId('auth')).toHaveTextContent('yes');
      });
      expect(apiPostMock).toHaveBeenCalledTimes(2);
      expect(setAccessTokenMock).toHaveBeenCalledWith('retry-token');
    });
  });

  describe('logout', () => {
    it('clears the user, token, and Sentry identity', async () => {
      getAccessTokenMock.mockReturnValue('token-abc');
      apiGetMock.mockResolvedValueOnce({
        data: {
          id: 'user-4',
          email: 'd@example.com',
          name: 'D',
          role: 'ACCOUNTANT',
          branchId: null,
          branch: null,
        },
      });
      apiPostMock.mockResolvedValueOnce({ data: {} });

      renderHarness();
      await waitFor(() => {
        expect(screen.getByTestId('auth')).toHaveTextContent('yes');
      });
      setUserMock.mockClear();
      setAccessTokenMock.mockClear();

      await userEvent.click(screen.getByText('logout'));

      await waitFor(() => {
        expect(screen.getByTestId('auth')).toHaveTextContent('no');
      });
      expect(apiPostMock).toHaveBeenCalledWith('/auth/logout', {});
      expect(setAccessTokenMock).toHaveBeenCalledWith(null);
      expect(setUserMock).toHaveBeenCalledWith(null);
    });
  });

  describe('useAuth', () => {
    it('throws when called outside of an AuthProvider', () => {
      // React logs the caught error; silence it for clean output.
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      function Orphan() {
        useAuth();
        return null;
      }
      expect(() => render(<Orphan />)).toThrow(
        /useAuth must be used within an AuthProvider/,
      );
      spy.mockRestore();
    });
  });
});
