import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router';
import { CategoryPage } from '../CategoryPage';

const pending = vi.hoisted(() => {
  let resolveTestMode!: () => void;
  const testMode = new Promise<void>((resolve) => { resolveTestMode = resolve; });
  return { testMode, resolveTestMode };
});

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));
vi.mock('@/pages/SettingsPage/components/TestModeToggle', async () => {
  await pending.testMode;
  return {
    TestModeToggle: function TestModeToggle() {
      const [expanded, setExpanded] = useState(false);
      return (
        <div>
          <button onClick={() => setExpanded(true)}>expand help</button>
          {expanded && <p>expanded help</p>}
        </div>
      );
    },
  };
});
vi.mock('@/pages/SettingsPage/tabs/PdpaTab', () => ({ PdpaTab: () => <div>pdpa-form</div> }));
vi.mock('@/pages/SettingsPage/tabs/OffsiteBackupTab', () => ({
  OffsiteBackupTab: () => <div>backup-form</div>,
}));

describe('settings hash navigation while loading', () => {
  it('waits for earlier panels, scrolls once, and handles a new hash in the same category', async () => {
    const scrollSpy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollSpy;
    render(
      <MemoryRouter initialEntries={['/settings/system#backup']}>
        <Link to="#pdpa">jump to privacy</Link>
        <CategoryPage categoryId="system" />
      </MemoryRouter>,
    );

    // The destination is ready while a preceding form still has its short placeholder.
    expect(await screen.findByText('backup-form')).toBeInTheDocument();
    expect(document.getElementById('backup')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('กำลังโหลดโหมดทดสอบ');
    expect(scrollSpy).not.toHaveBeenCalled();

    await act(async () => { pending.resolveTestMode(); });
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));
    expect(scrollSpy.mock.instances[0]).toBe(document.getElementById('backup'));
    expect(scrollSpy).toHaveBeenLastCalledWith({ block: 'start' });

    // Later form edits must not keep pulling the employee back to the original anchor.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'expand help' })); });
    expect(screen.getByText('expanded help')).toBeInTheDocument();
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('link', { name: 'jump to privacy' }));
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(2));
    expect(scrollSpy.mock.instances[1]).toBe(document.getElementById('pdpa'));
  });
});
