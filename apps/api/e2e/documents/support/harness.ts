/* eslint-disable @typescript-eslint/no-explicit-any */
import { INestApplication, Logger } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { configureApp, installRuntimeGlobals } from '../../../src/app.setup';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { PrismaFinanceService } from '../../../src/prisma/prisma-finance.service';
import { StorageService } from '../../../src/modules/storage/storage.service';
import { NotificationTransportService } from '../../../src/modules/notifications/services/notification-transport.service';
import { EmailService } from '../../../src/modules/email/email.service';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../prisma/seed-coa-shop';
import { assertDisposableRuntime } from './runtime';

/**
 * Documents integration harness — boots the REAL AppModule through the same
 * `configureApp()` main.ts uses (global prefix, ValidationPipe, CSRF/throttle/
 * audience guards, EntityScopeInterceptor, response envelope, exception filter),
 * on a disposable SHOP + FINANCE PostgreSQL, a private local storage directory
 * and a real Chromium renderer.
 *
 * Nothing on the request path is replaced: JwtAuthGuard validates real tokens
 * issued by POST /auth/login (bcrypt), RolesGuard / ContractFileAccessGuard /
 * BranchGuard run as in production. The only fakes are the outbound message
 * transports (LINE / SMS / e-mail), which are recorded instead of sent — see
 * `harness.external.calls` and report them under `simulated`.
 */
export type Company = 'SHOP' | 'FINANCE';

export interface Session {
  token: string;
  user: { id: string; email: string; role: string; branchId: string | null; accessibleCompanies: string[]; primaryCompany: string | null };
}

export interface ClientOptions {
  session?: Session | null;
  /** Bearer token override (e.g. a tampered or expired token). */
  token?: string;
  /** `?company=` scope like apps/web/src/lib/api.ts adds; `null` sends none. */
  company?: Company | null;
}

export interface ExternalCall { channel: 'line' | 'line-flex' | 'sms' | 'email'; recipient: string; summary: string; at: string }
export interface ExternalRecorder { calls: ExternalCall[]; restore(): void }

export interface DocumentsHarness {
  app: INestApplication;
  /** e.g. http://127.0.0.1:53021/api — the same origin supertest hits. */
  baseUrl: string;
  prisma: PrismaService;
  finance: PrismaFinanceService;
  storage: { backend: string; location: string };
  external: ExternalRecorder;
  login(email: string, password: string): Promise<Session>;
  client(options?: ClientOptions): Client;
  close(): Promise<void>;
}

export class Client {
  constructor(private readonly server: any, private readonly options: ClientOptions) {}

  private prepare(test: request.Test): request.Test {
    // CsrfGuard (global APP_GUARD) requires this header on every state-changing request.
    test.set('X-Requested-With', 'XMLHttpRequest');
    const token = this.options.token ?? this.options.session?.token;
    if (token) test.set('Authorization', `Bearer ${token}`);
    const company = this.options.company === undefined ? 'SHOP' : this.options.company;
    if (company) test.query({ company: company.toLowerCase() });
    return test;
  }

  get(path: string): request.Test { return this.prepare(request(this.server).get(`/api${path}`)); }
  delete(path: string): request.Test { return this.prepare(request(this.server).delete(`/api${path}`)); }
  post(path: string, body: unknown = {}): request.Test { return this.prepare(request(this.server).post(`/api${path}`)).send(body as object); }
  patch(path: string, body: unknown = {}): request.Test { return this.prepare(request(this.server).patch(`/api${path}`)).send(body as object); }
}

function recordExternalTransports(): ExternalRecorder {
  const calls: ExternalCall[] = [];
  const at = () => new Date().toISOString();
  const transport = NotificationTransportService.prototype as any;
  const spies = [
    jest.spyOn(transport, 'sendLine').mockImplementation(async (recipient: string, message: string) => { calls.push({ channel: 'line', recipient, summary: String(message).slice(0, 120), at: at() }); }),
    jest.spyOn(transport, 'sendLineFlexMessage').mockImplementation(async (recipient: string) => { calls.push({ channel: 'line-flex', recipient, summary: 'flex message', at: at() }); }),
    jest.spyOn(transport, 'sendLineFromQueue').mockImplementation(async (recipient: string, message: string) => { calls.push({ channel: 'line', recipient, summary: String(message).slice(0, 120), at: at() }); return undefined; }),
    jest.spyOn(transport, 'sendSms').mockImplementation(async (recipient: string, message: string) => { calls.push({ channel: 'sms', recipient, summary: String(message).slice(0, 120), at: at() }); return 'SIMULATED'; }),
    jest.spyOn(transport, 'sendSmsFromQueue').mockImplementation(async (recipient: string, message: string) => { calls.push({ channel: 'sms', recipient, summary: String(message).slice(0, 120), at: at() }); return 'SIMULATED'; }),
    jest.spyOn(EmailService.prototype as any, 'sendMail').mockImplementation(async (params: { to: string | string[]; subject: string }) => { calls.push({ channel: 'email', recipient: Array.isArray(params.to) ? params.to.join(',') : params.to, summary: params.subject, at: at() }); return true; }),
  ];
  return { calls, restore: () => spies.forEach((spy) => spy.mockRestore()) };
}

export interface StartOptions {
  /** Extra overrides for providers that are NOT part of the flow under test (external adapters only). */
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/**
 * Reference data the real AppModule requires at boot: AccountRoleService.onModuleInit
 * refuses to start when account_role_map (seeded by migrations) points at codes
 * missing from chart_of_accounts. Production carries the CPA chart, so the harness
 * upserts the same canonical CSVs (idempotent — same as `npm run seed:coa`).
 */
export async function seedReferenceData(): Promise<{ finance: { created: number; updated: number }; shop: { created: number; updated: number } }> {
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const finance = await seedFinanceCoa(prisma);
    const shop = await seedShopCoa(prisma);
    return { finance, shop };
  } finally {
    await prisma.$disconnect();
  }
}

export async function startDocumentsApp(options: StartOptions = {}): Promise<DocumentsHarness> {
  assertDisposableRuntime();
  installRuntimeGlobals();
  await seedReferenceData();
  const external = recordExternalTransports();
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.customize) builder = options.customize(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  configureApp(app, { swagger: false, logger: new Logger('DocumentsHarness') });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const storage = app.get(StorageService).describe();
  if (storage.backend !== 'local') {
    await app.close();
    throw new Error(`Documents harness expected local storage, got ${storage.backend}`);
  }
  const server = app.getHttpServer();
  return {
    app,
    baseUrl,
    prisma: app.get(PrismaService),
    finance: app.get(PrismaFinanceService),
    storage,
    external,
    async login(email, password) {
      const response = await request(server).post('/api/auth/login').set('X-Requested-With', 'XMLHttpRequest').send({ email, password });
      if (response.status !== 200 && response.status !== 201) throw new Error(`login ${email} failed: ${response.status} ${JSON.stringify(response.body)}`);
      return { token: response.body.data.accessToken, user: response.body.data.user };
    },
    client: (clientOptions = {}) => new Client(server, clientOptions),
    async close() {
      external.restore();
      await app.close();
    },
  };
}

/** Collect a streamed/binary supertest response as a Buffer (supertest parses application/pdf as Buffer already). */
export function bodyBuffer(response: request.Response): Buffer {
  if (Buffer.isBuffer(response.body)) return response.body;
  if (typeof response.text === 'string') return Buffer.from(response.text);
  return Buffer.from(JSON.stringify(response.body));
}
