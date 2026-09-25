import { it, expect, vi, afterEach } from 'vitest';
const get = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...args: unknown[]) => get(...args) },
  getErrorMessage: () => 'error',
}));
import { openCreditDocument, isRoomCreditDocument } from './credit-document';
afterEach(() => vi.restoreAllMocks());

it('opens protected room documents through the authenticated API, never a raw storage URL', async () => {
  const target = {
    document: { title: '', body: { textContent: '' } },
    location: { href: '' },
    close: vi.fn(),
    opener: null,
  };
  vi.spyOn(window, 'open').mockReturnValue(target as unknown as Window);
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:statement'),
      revokeObjectURL: vi.fn(),
    }),
  );
  get.mockResolvedValue({ data: new Blob(['pdf'], { type: 'application/pdf' }) });
  await openCreditDocument('/staff-chat/rooms/r/credit-check/files/f');
  expect(get).toHaveBeenCalledWith('/staff-chat/rooms/r/credit-check/files/f', {
    responseType: 'blob',
    timeout: 120000,
  });
  expect(target.location.href).toBe('blob:statement');
  expect(isRoomCreditDocument('https://evil.test/staff-chat/rooms/r/credit-check/files/f')).toBe(
    false,
  );
});

it('recognizes finance-application file URLs (GFIN precheck package) as protected room documents', () => {
  expect(isRoomCreditDocument('/finance-applications/app1/files/f1')).toBe(true);
  expect(isRoomCreditDocument('https://evil.test/finance-applications/app1/files/f1')).toBe(false);
});
