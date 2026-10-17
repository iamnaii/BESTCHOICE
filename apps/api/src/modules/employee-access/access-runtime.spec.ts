import { Controller, Get, Post, UseGuards, Injectable, CanActivate, ExecutionContext, INestApplication, Req, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityScopeInterceptor } from '../../interceptors/entity-scope.interceptor';
import { AccessSnapshotService } from './access-snapshot.service';
import { AccessPolicyService } from './access-policy';
import { AccessPolicyInterceptor } from './access-policy.interceptor';
import { ACCESS_BOUNDARIES } from './access-policy.registry';

const globalObservedUsers: unknown[] = [];
@Injectable()
class BeforeAuthenticationGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) { globalObservedUsers.push(ctx.switchToHttp().getRequest().user); return true; }
}
@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
@Roles('OWNER')
class ProductsController {
  @Get('hidden') hidden() { return { secret: true }; }
  @Get() findAll() { throw new Error('Unscoped controller must never run'); }
  @Get(':id') findOne() { return { allowed: true }; }
}
@Controller('employee-access')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
class EmployeeAccessController {
  @Get('me') me(@Req() req: any) { return { access: req.user.access }; }
}
@Controller('facebook')
class FacebookWebhookController {
  @Post() handleWebhook(@Req() req: any) {
    if (req.headers['x-provider-proof'] !== 'valid') throw new UnauthorizedException();
    return { received: true };
  }
}

describe('authenticated runtime HTTP boundary', () => {
  let app: INestApplication;
  let active: boolean;
  let snapshot: any;
  let token: string;
  const jwt = new JwtService({ secret: 'runtime-test-secret' });
  const dbRows = [{ id: 'a', company: 'SHOP', branchId: 'a' }, { id: 'b', company: 'SHOP', branchId: 'b' }];
  beforeEach(async () => {
    active = true;
    globalObservedUsers.length = 0;
    snapshot = { userId: 'u', managed: true, isOwner: false, revision: 1, grants: [{ positionId: 'p', company: 'SHOP', scope: 'BRANCHES', branchIds: ['a'], permissions: ['products.read'] }] };
    ACCESS_BOUNDARIES.set('ProductsController.findOne', async req => ({ kind: 'resource', resource: dbRows.find(r => r.id === req.params.id)! as any }));
    ACCESS_BOUNDARIES.set('ProductsController.findAll', async () => ({ kind: 'collection', company: 'SHOP', execute: async scope => dbRows.filter(row => scope.tuples.some(t => t.scope === 'BRANCHES' && t.branchIds.includes(row.branchId))) }));
    const module = await Test.createTestingModule({
      imports: [PassportModule], controllers: [ProductsController, FacebookWebhookController, EmployeeAccessController],
      providers: [JwtStrategy, JwtAuthGuard, RolesGuard, BranchGuard, AccessPolicyService,
        { provide: ConfigService, useValue: { get: () => 'runtime-test-secret' } },
        { provide: PrismaService, useValue: { user: { findUnique: async () => ({ id: 'u', name: 'Staff', role: 'SALES', isActive: active, branchId: 'legacy-wrong', accessibleCompanies: ['FINANCE'] }) }, customer: { findFirst: async () => ({ id: 'customer', name: 'Customer' }) } } },
        { provide: AccessSnapshotService, useValue: { forUser: async () => structuredClone(snapshot) } },
        { provide: APP_GUARD, useClass: BeforeAuthenticationGuard },
        { provide: APP_INTERCEPTOR, useClass: AccessPolicyInterceptor },
        { provide: APP_INTERCEPTOR, useClass: EntityScopeInterceptor }],
    }).compile();
    app = module.createNestApplication(); await app.init();
    token = jwt.sign({ sub: 'u', role: 'OWNER', aud: 'admin' });
  });
  afterEach(async () => { ACCESS_BOUNDARIES.clear(); await app.close(); });
  const bearer = (token: string) => `Bearer ${token}`;
  it('authorizes position after authentication before legacy roles/branch, without role spoofing', async () => {
    await request(app.getHttpServer()).get('/products/a?branchId=a').set('Authorization', bearer(token)).expect(200, { allowed: true });
    expect(globalObservedUsers).toEqual([undefined]);
  });
  it('denies direct ID bypass despite a forged branch filter', async () => {
    await request(app.getHttpServer()).get('/products/b?branchId=a').set('Authorization', bearer(token)).expect(403);
  });
  it('denies unknown staff route instead of falling back to OWNER from JWT', async () => {
    await request(app.getHttpServer()).get('/products/hidden').set('Authorization', bearer(token)).expect(403);
  });
  it('revokes a position on the next request with the same JWT', async () => {
    await request(app.getHttpServer()).get('/products/a').set('Authorization', bearer(token)).expect(200);
    snapshot.grants = []; snapshot.revision++;
    await request(app.getHttpServer()).get('/products/a').set('Authorization', bearer(token)).expect(403);
  });
  it('revokes a disabled account on the next request', async () => {
    await request(app.getHttpServer()).get('/products/a').set('Authorization', bearer(token)).expect(200);
    active = false;
    await request(app.getHttpServer()).get('/products/a').set('Authorization', bearer(token)).expect(401);
  });
  it('rejects signed CUSTOMER token on a staff route', async () => {
    const customer = jwt.sign({ sub: 'customer', role: 'CUSTOMER', aud: 'shop' });
    await request(app.getHttpServer()).get('/products/a').set('Authorization', bearer(customer)).expect(403);
  });
  it('keeps independent public webhook authentication', async () => {
    await request(app.getHttpServer()).post('/facebook').expect(401);
    await request(app.getHttpServer()).post('/facebook').set('x-provider-proof', 'valid').expect(201, { received: true });
  });
  it('rejects a representative branch as authorization for a whole collection', async () => {
    ACCESS_BOUNDARIES.set('ProductsController.findAll', async () => ({ kind: 'resource', resource: { company: 'SHOP', branchId: 'a' } }));
    await request(app.getHttpServer()).get('/products').set('Authorization', bearer(token)).expect(403);
  });
  it('allows own current snapshot with zero grants even when the UI sends its previous company', async () => {
    snapshot.grants = [];
    await request(app.getHttpServer()).get('/employee-access/me?company=SHOP').set('Authorization', bearer(token)).expect(200, { access: snapshot });
  });
  it('runs the registered scoped collection executor instead of the unscoped handler', async () => {
    await request(app.getHttpServer()).get('/products').set('Authorization', bearer(token)).expect(200, [dbRows[0]]);
  });
});
