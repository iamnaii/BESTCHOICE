import { ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isPermissionKey, PERMISSION_CATALOG } from '@installment/shared';
import { assertAccess, permissionScopes } from './access-context';
import { ACCESS_BOUNDARIES, ACCESS_POLICIES, RouteAccessPolicy } from './access-policy.registry';
export const ACCESS_POLICY_KEY = 'employeeAccessPolicy';
export const AccessPolicy = (policy: RouteAccessPolicy) => SetMetadata(ACCESS_POLICY_KEY, policy);
// Not client-settable: guards accept this marker only after this service has checked the route.
export const ACCESS_AUTHORIZED = Symbol('employeeAccessAuthorized');
export const ACCESS_COLLECTION_EXECUTE = Symbol('employeeAccessCollectionExecute');
export const ACCESS_SELF_SERVICE = Symbol('employeeAccessSelfService');
export interface AccessDenial { userId: string | null; route: string; permission: string | null; reason: string; }
@Injectable()
export class AccessPolicyService {
  constructor(private readonly reflector: Reflector) {}
  /** Task5 may attach durable/safe capture. No body, URL query, PII or source data. */
  onDenied?: (event: AccessDenial) => Promise<void> | void;
  async authorize(context: ExecutionContext): Promise<void> {
    if (context.getType() !== 'http') return;
    const request = context.switchToHttp().getRequest();
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const policy = this.reflector.getAllAndOverride<RouteAccessPolicy>(ACCESS_POLICY_KEY, [context.getHandler(), context.getClass()]) ?? ACCESS_POLICIES[route];
    const user = request.user;
    const deny = async (reason: string) => {
      try { await this.onDenied?.({ userId: user?.id ?? null, route, permission: policy?.permission ?? null, reason }); } catch { /* Capture failure cannot authorize. */ }
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงงานนี้');
    };
    if (!policy) return deny('UNCLASSIFIED');
    if (['public', 'integration'].includes(policy.classification)) return;
    if (policy.classification === 'customer') {
      // LIFF/custom customer guards may use their own principal, preserved here.
      if (user && user.role !== 'CUSTOMER' && user.aud !== 'shop') return deny('CUSTOMER_ONLY');
      return;
    }
    if (!user || user.role === 'CUSTOMER' || user.aud === 'shop') return deny('STAFF_REQUIRED');
    if (user.aud && user.aud !== 'admin') return deny('STAFF_AUDIENCE_REQUIRED');
    if (!user.access || user.access.userId !== user.id) return deny('SNAPSHOT_REQUIRED');
    request.accessMode = user.access.managed ? 'MANAGED' : 'LEGACY_UNMIGRATED';
    if (!user.access.managed) return;
    if (request[ACCESS_AUTHORIZED] === route) return;
    if (policy.classification === 'self-service') { request[ACCESS_SELF_SERVICE] = true; request[ACCESS_AUTHORIZED] = route; return; }
    if (!policy.permission || !isPermissionKey(policy.permission)) return deny('ACTION_REVIEW_REQUIRED');
    const definition = PERMISSION_CATALOG.find(p => p.key === policy.permission);
    if (definition?.ownerOnly && !user.access.isOwner) return deny('OWNER_REQUIRED');
    try {
      if (user.access.isOwner) {
        assertAccess(user, policy.permission, { company: 'SHOP' });
      } else {
        const boundary = ACCESS_BOUNDARIES.get(route);
        if (!boundary) return deny('RESOURCE_BOUNDARY_REQUIRED');
        const decision = await boundary(request, user.access, policy.permission);
        if (decision.kind === 'resource' && policy.resolution === 'record') {
          assertAccess(user, policy.permission, decision.resource);
        } else if (decision.kind === 'collection' && policy.resolution === 'collection' && ['SHOP', 'FINANCE'].includes(decision.company) && typeof decision.execute === 'function') {
          const tuples = permissionScopes(user, policy.permission, decision.company)
            .filter(t => t.scope !== 'BRANCHES' || t.branchIds.length > 0);
          if (!tuples.length) return deny('SCOPE_REQUIRED');
          const scope = { userId: user.id, permission: policy.permission, company: decision.company, tuples };
          request[ACCESS_COLLECTION_EXECUTE] = () => decision.execute(scope);
        } else return deny('RESOURCE_BOUNDARY_REQUIRED');
      }
    } catch (error) {
      return deny('RESOURCE_DENIED');
    }
    request[ACCESS_AUTHORIZED] = route;
  }
}
