import { handoffTransition } from './chat-handoff.service';
import type { TodoStatus } from '@prisma/client';
describe('Handoff transition contract', () => {
  const allowed: Record<string,TodoStatus> = { 'TODO:ACCEPT': 'DOING', 'TODO:CANCEL': 'CANCELLED', 'DOING:COMPLETE': 'DONE', 'DOING:CANCEL': 'CANCELLED' };
  for (const status of ['TODO','DOING','REVIEW','DONE','CANCELLED'] as const) for (const action of ['ACCEPT','COMPLETE','CANCEL'] as const) {
    it(`${status} + ${action}`, () => {
      const expected = allowed[`${status}:${action}`];
      if (expected) expect(handoffTransition(status,action)).toBe(expected);
      else expect(() => handoffTransition(status,action)).toThrow();
    });
  }
});
