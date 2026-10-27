import { Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { procurementPreparation } from '../../employee-access/access-preparation-context';
import { currentDomainAccess } from '../../employee-access/access-execution-context';
import { StorageService } from '../../storage/storage.service';
import { decodeBase64Image } from './trade-in.helpers';
export const tradeInPreparedFile = new AsyncLocalStorage<{ key: string; used: boolean }>();
/** One operation owns the staged key through all database attempts. */
export async function prepareTradeInFile<T>(
  storage: StorageService,
  base64: string | undefined,
  handler: () => Promise<T>,
): Promise<T> {
  const preparation = procurementPreparation.getStore();
  if (!preparation || currentDomainAccess()) return handler();
  await preparation.authorize?.();
  if (!base64) return preparation.execute(handler);
  const { buffer, contentType } = decodeBase64Image(base64);
  const key = `trade-ins/_pending/${randomUUID()}.${contentType.split('/')[1]}`;
  const cleanup = async () => {
    try {
      await storage.delete(key);
    } catch {
      new Logger('TradeInFilePreparation').error('Operation-owned trade-in file cleanup failed');
    }
  };
  try {
    await storage.upload(key, buffer, contentType);
  } catch (error) {
    await cleanup();
    throw error;
  }
  const state = { key, used: false };
  try {
    const result = await tradeInPreparedFile.run(state, () =>
      preparation.execute(async () => {
        state.used = false;
        return handler();
      }),
    );
    if (!state.used) await cleanup();
    return result;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
