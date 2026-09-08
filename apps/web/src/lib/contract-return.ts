/** Only the contract wizard is a valid destination for credit return links. */
export function contractReturnUrl(value: string | null): string | null {
  if (!value || !/^\/contracts\/create(?:\?|$)/.test(value) || /[\\#\r\n]/.test(value)) return null;
  const url = new URL(value, 'https://internal.invalid');
  if (url.pathname !== '/contracts/create') return null;
  const params = new URLSearchParams();
  for (const key of ['customerId', 'productId', 'fromRoom']) {
    const id = url.searchParams.get(key);
    if (id && /^[\w-]{1,128}$/.test(id)) params.set(key, id);
  }
  for (const key of ['downAmount', 'months']) {
    const raw = url.searchParams.get(key);
    const number = Number(raw);
    if (raw && Number.isFinite(number) && number >= 0 &&
      (key !== 'months' || (Number.isInteger(number) && number > 0))) params.set(key, raw);
  }
  if (url.searchParams.get('resume') === '1') params.set('resume', '1');
  return `/contracts/create${params.size ? `?${params}` : ''}`;
}

export function customerCreditUrl(customerId: string, returnTo?: string | null): string {
  const params = new URLSearchParams({ tab: 'credit' });
  const validReturn = contractReturnUrl(returnTo ?? null);
  // Do not carry another customer's unfinished contract through the approval queue.
  if (validReturn && new URL(validReturn, 'https://internal.invalid').searchParams.get('customerId') === customerId) {
    params.set('returnTo', validReturn);
  }
  return `/customers/${encodeURIComponent(customerId)}?${params}`;
}
