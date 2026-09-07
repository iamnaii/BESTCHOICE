import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CommandPalette from '../CommandPalette';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'SALES' } }) }));
vi.mock('@/pages/CollectionsPage/hooks/useUnionSearch', () => ({
  useUnionSearch: () => ({
    isLoading: false,
    data: { contracts: [{ id: 'server-match', contractNumber: 'BC-001', customerName: 'ลูกค้าที่ระบบค้นพบ', status: 'ACTIVE' }], customers: [], imeis: [], letterTrackings: [] },
  }),
}));

describe('command palette navigation search', () => {
  const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });
  afterEach(() => {
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });
  it('matches the POS alias without showing unrelated navigation or hiding server matches', async () => {
    render(<MemoryRouter><CommandPalette /></MemoryRouter>);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'POS' } });
    await waitFor(() => {
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(3);
      expect(options.filter((option) => option.textContent === 'ขายสินค้า')).toHaveLength(2);
      expect(screen.queryByRole('option', { name: /เพิ่มลูกค้าใหม่/ })).not.toBeInTheDocument();
    });
    expect(screen.getByText(/BC-001.*ลูกค้าที่ระบบค้นพบ/)).toBeInTheDocument();
  });
});
