import { expect, it, vi } from 'vitest';
import { apptState } from './appointment';
it('renders appointments in Bangkok even on a UTC device', () => {
 vi.stubEnv('TZ','UTC');
 try { expect(apptState('2026-10-06T01:00:00Z',new Date('2026-10-05T18:00:00Z'))).toMatchObject({kind:'today',label:'นัดวันนี้ 08:00'}); }
 finally {vi.unstubAllEnvs();}
});
