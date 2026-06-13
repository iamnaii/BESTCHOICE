import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchableSelect from './SearchableSelect';

const OPTIONS = ['ลำปาง', 'เชียงใหม่', 'ขอนแก่น'];
const noop = () => {};

// The options menu is the element carrying `max-h-60` (the scrollable results list).
const getMenu = (container: HTMLElement) =>
  container.querySelector('.max-h-60') as HTMLElement | null;

describe('SearchableSelect — openDirection', () => {
  it('opens the menu downward by default', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <SearchableSelect value="" onChange={noop} options={OPTIONS} placeholder="-- เลือก --" />,
    );
    await user.click(screen.getByPlaceholderText('-- เลือก --'));

    const menu = getMenu(container);
    expect(menu).toBeTruthy();
    expect(menu!.className).toContain('mt-1');
    expect(menu!.className).not.toContain('bottom-full');
  });

  it('opens the menu upward when openDirection="up" (so it is not clipped at the bottom of a modal)', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <SearchableSelect
        value=""
        onChange={noop}
        options={OPTIONS}
        placeholder="-- เลือก --"
        openDirection="up"
      />,
    );
    await user.click(screen.getByPlaceholderText('-- เลือก --'));

    const menu = getMenu(container);
    expect(menu).toBeTruthy();
    expect(menu!.className).toContain('bottom-full');
    expect(menu!.className).not.toContain('mt-1');
  });
});
