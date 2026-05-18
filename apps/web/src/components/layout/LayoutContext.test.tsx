import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { LayoutProvider, useLayout } from './LayoutContext';
import type { ReactNode } from 'react';

const wrapper = ({ children }: { children: ReactNode }) => (
  <LayoutProvider>{children}</LayoutProvider>
);

describe('LayoutContext currentZone persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('defaults to "shop" when no URL and no localStorage', () => {
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.currentZone).toBe('shop');
  });

  it('reads from URL ?zone= first (priority 1)', () => {
    window.history.replaceState({}, '', '/?zone=fin');
    localStorage.setItem('bc.sidebar.lastZone', 'shop');
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.currentZone).toBe('fin');
  });

  it('falls back to localStorage when URL has no ?zone= (priority 2)', () => {
    localStorage.setItem('bc.sidebar.lastZone', 'fin');
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.currentZone).toBe('fin');
  });

  it('setCurrentZone updates state + localStorage + URL', () => {
    const { result } = renderHook(() => useLayout(), { wrapper });
    act(() => result.current.setCurrentZone('fin'));
    expect(result.current.currentZone).toBe('fin');
    expect(localStorage.getItem('bc.sidebar.lastZone')).toBe('fin');
    expect(new URL(window.location.href).searchParams.get('zone')).toBe('fin');
  });

  it('ignores invalid zone in URL', () => {
    window.history.replaceState({}, '', '/?zone=invalid');
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.currentZone).toBe('shop');
  });

  it('ignores invalid zone in localStorage', () => {
    localStorage.setItem('bc.sidebar.lastZone', 'invalid');
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.currentZone).toBe('shop');
  });

  it('accepts "settings" zone from URL', () => {
    window.history.replaceState({}, '', '/?zone=settings');
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.currentZone).toBe('settings');
  });
});
