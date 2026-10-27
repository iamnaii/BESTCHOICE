import { AccessPolicyService } from '../../employee-access/access-policy';
import { lastValueFrom, isObservable } from 'rxjs';
import { ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly policies: AccessPolicyService;
  constructor(private reflector: Reflector, @Optional() policies?: AccessPolicyService) {
    super();
    // Standalone controller test modules may omit the Global module. Never skip
    // authorization: use the same fail-closed policy engine without a capture sink.
    this.policies = policies ?? new AccessPolicyService(reflector);
  }

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const result = super.canActivate(context);
    const authenticated = isObservable(result) ? await lastValueFrom(result) : await result;
    if (authenticated) await this.policies.authorize(context);
    return authenticated;
  }
}
