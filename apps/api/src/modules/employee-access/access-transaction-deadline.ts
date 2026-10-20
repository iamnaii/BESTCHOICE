import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Internal opt-in absolute budget. Never constructed from request input. */
export interface AccessTransactionDeadline {
  readonly expiresAt: number;
  check(): void;
}

const models = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name[0].toLowerCase() + model.name.slice(1),
    new Set(model.fields.filter((field) => field.kind !== 'object').map((field) => field.name)),
  ]),
);
const rawMethods = new Set(['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe']);

function assertSingleStatement(model: string, method: PropertyKey, args: unknown[]) {
  const fields = models.get(model)!;
  const input = args[0] as Record<string, unknown> | undefined;
  const keys =
    method === 'create'
      ? ['data', 'select']
      : method === 'count'
        ? ['where']
        : method === 'findUnique' || method === 'findUniqueOrThrow'
          ? ['where', 'select']
          : [];
  const select = input?.select;
  const data = input?.data;
  if (
    !keys.length ||
    args.length !== 1 ||
    !input ||
    typeof input !== 'object' ||
    Object.keys(input).some((key) => !keys.includes(key)) ||
    (select !== undefined &&
      (!select ||
        typeof select !== 'object' ||
        Object.entries(select).some(
          ([key, value]) => !fields.has(key) || typeof value !== 'boolean',
        ))) ||
    (method === 'create' &&
      (!data || typeof data !== 'object' || Object.keys(data).some((key) => !fields.has(key))))
  )
    throw new Error('Unsupported compound query in OCR deadline transaction');
}

/**
 * Prisma's interactive timeout alone does not interrupt active PostgreSQL lock waits.
 * Only admitted scalar model shapes and trusted single SQL raw calls are supported.
 * Refresh LOCAL server timeouts around each call, serializing setup + execution
 * even for Promise.all callers. Cancellation aborts this transaction, never a pooled PID.
 */
async function refreshDeadline(tx: Prisma.TransactionClient, deadline: AccessTransactionDeadline) {
  deadline.check();
  const remaining = Math.max(1, deadline.expiresAt - Date.now());
  await tx.$queryRaw`SELECT set_config('statement_timeout', ${`${remaining}ms`}, true),
    set_config('lock_timeout', ${`${remaining}ms`}, true),
    set_config('idle_in_transaction_session_timeout', ${`${remaining}ms`}, true)`;
  deadline.check();
}

function deadlineClient(
  tx: Prisma.TransactionClient,
  deadline: AccessTransactionDeadline,
): Prisma.TransactionClient {
  let queue: Promise<unknown> = Promise.resolve();
  const execute = (work: () => Promise<unknown>) => {
    const pending = queue.then(async () => {
      await refreshDeadline(tx, deadline);
      const result = await work();
      // Idle timeout starts after the statement, so a long successful query must
      // not leave its older, larger duration armed for a later callback wait.
      await refreshDeadline(tx, deadline);
      return result;
    });
    queue = pending.catch(() => undefined);
    return pending;
  };
  return new Proxy(tx, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof key === 'string' && rawMethods.has(key))
        return (...args: unknown[]) => execute(() => value.apply(target, args));
      if (typeof key === 'string' && models.has(key))
        return new Proxy(value, {
          get(delegate, method) {
            const fn = Reflect.get(delegate, method);
            return typeof fn === 'function'
              ? (...args: unknown[]) => {
                  assertSingleStatement(key, method, args);
                  return execute(() => fn.apply(delegate, args));
                }
              : fn;
          },
        });
      return value;
    },
  });
}

export async function accessTransaction<T>(
  prisma: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout: number },
  deadline?: AccessTransactionDeadline,
): Promise<T> {
  // Keep existing acquisition/default/export timeout semantics exactly as before.
  if (!deadline) return prisma.$transaction(work, options);
  deadline.check();
  const remaining = Math.max(1, deadline.expiresAt - Date.now());
  return prisma.$transaction(
    async (tx) => {
      // Acquisition may have consumed budget. Arm server idle expiry even if
      // the callback has not yet issued a query.
      await refreshDeadline(tx, deadline);
      const result = await work(deadlineClient(tx, deadline));
      // COMMIT must inherit the remaining duration, not a prior query's budget.
      await refreshDeadline(tx, deadline);
      return result;
    },
    {
      ...options,
      maxWait: Math.min(2000, remaining),
      timeout: Math.min(options.timeout, remaining),
    },
  );
}
