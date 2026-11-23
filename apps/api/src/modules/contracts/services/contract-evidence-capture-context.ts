import { AsyncLocalStorage } from 'node:async_hooks';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

interface CreationRequest {
  actorId: string;
  productId: string;
  customerId: string;
  branchId: string;
  admitted: WeakSet<object>;
  created: WeakMap<object, Set<string>>;
}
const context = new AsyncLocalStorage<Readonly<CreationRequest>>();
const handlers = new WeakSet<object>();
/** Register the exact authenticated canonical creation handler, never arbitrary service calls. */
export function registerContractEvidenceCapture(handler: object) { handlers.add(handler); }
export const contractEvidenceRequest = () => context.getStore();
export function admitContractEvidenceTransaction(tx: object) { context.getStore()?.admitted.add(tx); }
/** Bound only immediately after canonical tx.contract.create; a read/old draft is insufficient. */
export function bindCreatedContractEvidence(tx: object, id: string) {
  const request = context.getStore();
  if (!request?.admitted.has(tx)) return;
  const ids = request.created.get(tx) ?? new Set<string>();
  ids.add(id);
  request.created.set(tx, ids);
}
export function consumeContractEvidenceCapture(tx: object, id: string) {
  const request = context.getStore();
  const ids = request?.created.get(tx);
  if (!request || !ids?.delete(id)) return undefined;
  return request;
}

@Injectable()
export class ContractEvidenceCaptureInterceptor implements NestInterceptor {
  intercept(execution: ExecutionContext, next: CallHandler) {
    if (!handlers.has(execution.getHandler())) return next.handle();
    const request = execution.switchToHttp().getRequest<{
      user?: { id?: string }; body?: { productId?: string; customerId?: string; branchId?: string };
    }>();
    if (!request.user?.id || !request.body?.productId || !request.body.customerId || !request.body.branchId) return next.handle();
    const proof = Object.freeze({ actorId: request.user.id, productId: request.body.productId,
      customerId: request.body.customerId, branchId: request.body.branchId, admitted: new WeakSet<object>(), created: new WeakMap<object, Set<string>>() });
    return new Observable(subscriber => context.run(proof, () => next.handle().subscribe(subscriber)));
  }
}
