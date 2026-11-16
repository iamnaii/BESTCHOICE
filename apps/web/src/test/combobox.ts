import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** user-event reads `{…}` and `[…]` as key descriptors; double them to type them literally. */
const literal = (text: string) => text.replace(/[{[]/g, '$&$&');

async function openMenu(user: UserEvent, name: string | RegExp) {
  const trigger = await screen.findByRole('combobox', { name });
  if (trigger.getAttribute('aria-expanded') !== 'true') await user.click(trigger);
  // The trigger's aria-controls (set by Radix) is the id of the portalled menu,
  // [data-slot="combobox-content"].
  const content = await waitFor(() => {
    const id = trigger.getAttribute('aria-controls');
    const el = id ? document.getElementById(id) : null;
    if (!el) throw new Error(`Combobox "${String(name)}" did not open (disabled?)`);
    if (!el.matches('[data-slot="combobox-content"]')) {
      throw new Error(
        `"${String(name)}" is not a Combobox (no [data-slot="combobox-content"] menu)`,
      );
    }
    return el;
  });
  return { trigger, content, listbox: within(content).getByRole('listbox') };
}

/** Opens the `Combobox` whose trigger is named `name` (its label) and returns its listbox. */
export async function openCombobox(user: UserEvent, name: string | RegExp): Promise<HTMLElement> {
  return (await openMenu(user, name)).listbox;
}

/**
 * Opens the `Combobox` named `name`, optionally types `opts.search` into its search box, clicks
 * the row whose accessible name is `option`, and resolves once the menu has closed — so a pick
 * that cannot happen (a disabled row, a `pending` menu) fails the test instead of passing silently.
 */
export async function pickComboOption(
  user: UserEvent,
  name: string | RegExp,
  option: string | RegExp,
  opts: { search?: string } = {},
): Promise<void> {
  const { trigger, content } = await openMenu(user, name);
  if (opts.search !== undefined) {
    // The search box is the only role=combobox inside the menu (cmdk's input).
    const search = within(content).getByRole('combobox');
    await user.clear(search);
    if (opts.search) await user.type(search, literal(opts.search));
  }
  await user.click(await within(content).findByRole('option', { name: option }));
  await waitFor(() => {
    if (trigger.getAttribute('aria-expanded') === 'true') {
      throw new Error(
        `Combobox "${String(name)}" is still open after clicking "${String(option)}"`,
      );
    }
  });
}
