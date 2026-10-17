import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, lastValueFrom } from 'rxjs';
import { ACCESS_COLLECTION_EXECUTE, ACCESS_RESOURCE_EXECUTE, AccessPolicyService } from './access-policy';
@Injectable()
export class AccessPolicyInterceptor implements NestInterceptor {
  constructor(private readonly policies: AccessPolicyService) {}
  async intercept(context: ExecutionContext, next: CallHandler) {
    await this.policies.authorize(context);
    if (context.getType() === 'http') {
      const execute = context.switchToHttp().getRequest()[ACCESS_COLLECTION_EXECUTE];
      if (execute) return from(execute());
      const resourceExecute = context.switchToHttp().getRequest()[ACCESS_RESOURCE_EXECUTE];
      if (resourceExecute) return from(resourceExecute(() => lastValueFrom(next.handle())));
    }
    return next.handle();
  }
}
