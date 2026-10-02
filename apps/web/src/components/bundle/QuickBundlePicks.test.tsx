import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuickBundlePicks from './QuickBundlePicks';
import type { BundleProduct } from './BundleSearch';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ default: { get } }));
const film: BundleProduct = {
  id: 'film-1',
  name: 'ฟิล์ม iPhone 15',
  brand: 'Apple',
  model: 'iPhone 15',
  category: 'ACCESSORY',
};
const caseOne: BundleProduct = { ...film, id: 'case-1', name: 'เคส iPhone 15' };
const caseTwo: BundleProduct = { ...film, id: 'case-2', name: 'เคสกันกระแทก iPhone 15' };
function Harness({ branchId = 'b1', disabled = false }: { branchId?: string; disabled?: boolean }) {
  const [selected, setSelected] = useState<BundleProduct[]>([]);
  return (
    <>
      <QuickBundlePicks
        branchId={branchId}
        device={{ id: 'phone-15', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW' }}
        excludeIds={selected.map((p) => p.id)}
        disabled={disabled}
        onAdd={(p) => setSelected((old) => [...old, p])}
        onSearch={() => undefined}
      />
      <output aria-label="ของแถมที่เลือก">{selected.map((p) => p.name).join(', ')}</output>
      <button onClick={() => setSelected([])}>นำออก</button>
    </>
  );
}
function renderPicks(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (_url, { params }) => {
    const products =
      params.search === 'ฟิล์ม' ? [film] : params.search === 'เคส' ? [caseOne, caseTwo] : [];
    return { data: { data: products, total: products.length } };
  });
});
describe('POS quick freebies', () => {
  it('adds the single in-stock unit in one click, blocks duplicate selection, and allows removal/re-add', async () => {
    renderPicks();
    const pick = screen.getByRole('button', { name: /ฟิล์ม/ });
    await waitFor(() => expect(pick).toBeEnabled());
    fireEvent.click(pick);
    expect(screen.getByLabelText('ของแถมที่เลือก')).toHaveTextContent(film.name);
    expect(pick).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'นำออก' }));
    expect(pick).toBeEnabled();
    fireEvent.click(pick);
    expect(screen.getByLabelText('ของแถมที่เลือก')).toHaveTextContent(film.name);
    expect(get).toHaveBeenCalledWith('/products', {
      params: {
        search: 'ฟิล์ม',
        branchId: 'b1',
        category: 'ACCESSORY',
        status: 'IN_STOCK',
        limit: '10',
        compatibleWithProductId: 'phone-15',
      },
    });
  });
  it('asks which model when multiple units exist instead of silently picking the first', async () => {
    renderPicks();
    const pick = screen.getByRole('button', { name: 'เคส' });
    await waitFor(() => expect(pick).toBeEnabled());
    fireEvent.click(pick);
    expect(screen.getByLabelText('ของแถมที่เลือก')).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole('button', { name: caseTwo.name }));
    expect(screen.getByLabelText('ของแถมที่เลือก')).toHaveTextContent(caseTwo.name);
    fireEvent.click(pick);
    expect(screen.queryByRole('button', { name: caseTwo.name })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: caseOne.name })).toBeEnabled();
  });
  it('rejects an unrelated model even if a stale server result contains it', async () => {
    get.mockResolvedValue({
      data: { data: [{ ...film, model: 'iPhone 15 Pro', name: 'ฟิล์ม iPhone 15 Pro' }], total: 1 },
    });
    renderPicks();
    expect(await screen.findByRole('button', { name: 'ฟิล์ม ไม่มีตรงรุ่น' })).toBeDisabled();
    expect(screen.getByLabelText('ของแถมที่เลือก')).toBeEmptyDOMElement();
  });
  it('requires a main-product branch and never suggests stock from all branches', () => {
    renderPicks({ branchId: '' });
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'ฟิล์ม' })).toBeDisabled();
  });
  it('disables unavailable stock and all actions while submitting', async () => {
    renderPicks({ disabled: true });
    expect(await screen.findByRole('button', { name: 'ชุดชาร์จ ไม่มีตรงรุ่น' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ฟิล์ม' })).toBeDisabled();
  });
  it('provides retry on a failed stock request', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    renderPicks();
    fireEvent.click(await screen.findByRole('button', { name: 'ฟิล์ม ลองใหม่' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'ฟิล์ม' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'ฟิล์ม' }));
    expect(screen.getByLabelText('ของแถมที่เลือก')).toHaveTextContent(film.name);
  });
});
