import { describe, it, expect } from 'vitest';
import { resolveCanReverse } from '../reverse-permission';

/**
 * Mirrors the backend ReversePermissionGuard spec so the UI button-visibility
 * stays in lock-step with what the server will actually allow (Audit Finding A).
 */
describe('resolveCanReverse — client mirror of backend canUserReverse', () => {
  it('OWNER is always allowed, regardless of mode', () => {
    expect(resolveCanReverse('OWNER_ONLY', 'OWNER')).toBe(true);
    expect(resolveCanReverse('CUSTOM', 'OWNER', null)).toBe(true);
    expect(resolveCanReverse('OWNER+FINANCE_MANAGER', 'OWNER')).toBe(true);
  });

  it('OWNER_ONLY rejects FINANCE_MANAGER and ACCOUNTANT', () => {
    expect(resolveCanReverse('OWNER_ONLY', 'FINANCE_MANAGER')).toBe(false);
    expect(resolveCanReverse('OWNER_ONLY', 'ACCOUNTANT')).toBe(false);
  });

  it('OWNER+FINANCE_MANAGER (default) allows FM, rejects ACCOUNTANT', () => {
    expect(resolveCanReverse('OWNER+FINANCE_MANAGER', 'FINANCE_MANAGER')).toBe(true);
    expect(resolveCanReverse('OWNER+FINANCE_MANAGER', 'ACCOUNTANT')).toBe(false);
  });

  it('OWNER+FINANCE_MANAGER+ACCOUNTANT widens to include ACCOUNTANT', () => {
    expect(resolveCanReverse('OWNER+FINANCE_MANAGER+ACCOUNTANT', 'ACCOUNTANT')).toBe(true);
    expect(resolveCanReverse('OWNER+FINANCE_MANAGER+ACCOUNTANT', 'FINANCE_MANAGER')).toBe(true);
  });

  it('CUSTOM consults canReverseOverride for non-owner roles', () => {
    expect(resolveCanReverse('CUSTOM', 'ACCOUNTANT', true)).toBe(true);
    expect(resolveCanReverse('CUSTOM', 'ACCOUNTANT', false)).toBe(false);
    expect(resolveCanReverse('CUSTOM', 'ACCOUNTANT', null)).toBe(false);
    expect(resolveCanReverse('CUSTOM', 'FINANCE_MANAGER', undefined)).toBe(false);
  });

  it('SALES / BRANCH_MANAGER never allowed via a static mode', () => {
    expect(resolveCanReverse('OWNER+FINANCE_MANAGER+ACCOUNTANT', 'SALES')).toBe(false);
    expect(resolveCanReverse('OWNER+FINANCE_MANAGER', 'BRANCH_MANAGER')).toBe(false);
  });

  it('missing role is rejected', () => {
    expect(resolveCanReverse('OWNER+FINANCE_MANAGER', undefined)).toBe(false);
    expect(resolveCanReverse('OWNER+FINANCE_MANAGER', null)).toBe(false);
  });
});
