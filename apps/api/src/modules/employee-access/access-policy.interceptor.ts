import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from } from 'rxjs';
import { ACCESS_COLLECTION_EXECUTE, AccessPolicyService } from './access-policy';
@Injectable()
export class AccessPolicyInterceptor implements NestInterceptor {
  constructor(private readonly policies: AccessPolicyService) {}
  async intercept(context: ExecutionContext, next: CallHandler) {
    await this.policies.authorize(context);
    if (context.getType() === 'http') {
      const execute = context.switchToHttp().getRequest()[ACCESS_COLLECTION_EXECUTE];
      if (execute) return from(execute());
    }
    return next.handle();
  }
}
