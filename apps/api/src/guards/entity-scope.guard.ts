import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ENTITY_KEY, EntityType } from '../decorators/entity.decorator';

/**
 * SP7.1 — Reads @Entity(...) metadata and rejects requests where the
 * authenticated user doesn't have the required company in their
 * accessibleCompanies list.
 *
 * If no @Entity decoration is present → allow (handler is entity-agnostic).
 * If user has no accessibleCompanies (e.g. legacy account pre-SP7.1 backfill)
 *   → reject 403.
 */
@Injectable()
export class EntityScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<EntityType>(ENTITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { accessibleCompanies?: string[] } | undefined;

    if (!user?.accessibleCompanies?.includes(required)) {
      throw new ForbiddenException(
        `Handler ต้องการสิทธิ์ company ${required}; user สิทธิ์: ${
          user?.accessibleCompanies?.join(',') ?? '(none)'
        }`,
      );
    }

    return true;
  }
}
