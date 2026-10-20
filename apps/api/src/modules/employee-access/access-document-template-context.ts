import { AsyncLocalStorage } from 'node:async_hooks';
import { AccessSnapshot } from '@installment/shared';
import { AccessTransactionDeadline } from './access-transaction-deadline';

export const TEMPLATE_OPERATIONS = [
  'findAllTemplates',
  'findOneTemplate',
  'createTemplate',
  'updateTemplate',
  'deleteTemplate',
  'generateTemplateFromFile',
] as const;
export type TemplateOperation = (typeof TEMPLATE_OPERATIONS)[number];
export const templateRequest = new AsyncLocalStorage<{
  actorId: string;
  operation: TemplateOperation;
  snapshot?: AccessSnapshot;
  stage?: (
    stage: 'PREPARE' | 'ADMITTED' | 'COMPLETED',
    deadline: AccessTransactionDeadline,
  ) => Promise<void>;
}>();
