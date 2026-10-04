import type { QueryClient } from '@tanstack/react-query';

export const customerCreditQueryKeys = [
  'customers',
  'credit-checks',
  'customer-credit-checks',
  'customer-latest-credit',
  'customer-credit-check-latest-statement',
] as const;

/** Linking or merging a customer also changes the room and inbox summaries. */
export function invalidateRoomCustomerQueries(queryClient: QueryClient, roomId: string): void {
  queryClient.invalidateQueries({ queryKey: ['chat-room', roomId] });
  queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
  for (const key of customerCreditQueryKeys) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}
