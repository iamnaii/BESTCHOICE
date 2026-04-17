# Rich Menu Alias Multi-Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Rich Menu management for both SHOP and FINANCE LINE OA channels with alias-based switching (default/verified) so `switchRichMenu()` works for both channels end-to-end.

**Architecture:** Make `RichMenuService` channel-aware by replacing hardcoded `getShopChannelToken()` with `getChannelToken(channel)`. Add `setRichMenuAlias` + `getRichMenuAliases` service methods that read/write SystemConfig (4 alias keys). Update existing controller endpoints to accept `channel` param and add 2 new alias endpoints. Frontend adds top-level SHOP/FINANCE tabs on `/settings/rich-menu`, keys queries by channel, and adds alias dropdown + badges on menu cards.

**Tech Stack:** NestJS + Prisma (API), React + react-query + shadcn/ui (Web), Jest (tests)

**Spec:** [2026-04-17-rich-menu-alias-multi-channel-design.md](../specs/2026-04-17-rich-menu-alias-multi-channel-design.md)

---

## File Structure

**Modify:**
- `apps/api/src/modules/line-oa/rich-menu/rich-menu.service.ts` — channel-aware methods, alias methods
- `apps/api/src/modules/line-oa/line-oa.controller.ts` — rich-menu endpoints (lines 238-327)
- `apps/api/src/modules/integrations/integration-registry.ts` — add `liffId` to `line-finance` (lines 64-86)
- `apps/web/src/pages/RichMenuPage.tsx` — channel tabs, channel-aware state, alias UI

**Create:**
- `apps/api/src/modules/line-oa/rich-menu/rich-menu.service.spec.ts` — unit tests
- `apps/api/src/modules/line-oa/rich-menu/dto/set-alias.dto.ts` — validation DTO

**No DB migration required** — SystemConfig table already exists.

---

### Task 1: Backend — Add `getChannelToken` helper with tests

**Files:**
- Create: `apps/api/src/modules/line-oa/rich-menu/rich-menu.service.spec.ts`
- Modify: `apps/api/src/modules/line-oa/rich-menu/rich-menu.service.ts` (lines 51-53)

- [ ] **Step 1: Create the spec file with failing test**

Create `apps/api/src/modules/line-oa/rich-menu/rich-menu.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RichMenuService } from './rich-menu.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationConfigService } from '../../integrations/integration-config.service';

describe('RichMenuService', () => {
  let service: RichMenuService;
  let integrationConfig: { getValue: jest.Mock };

  beforeEach(async () => {
    integrationConfig = { getValue: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RichMenuService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: PrismaService, useValue: { systemConfig: { findFirst: jest.fn(), upsert: jest.fn() } } },
        { provide: IntegrationConfigService, useValue: integrationConfig },
      ],
    }).compile();

    service = module.get<RichMenuService>(RichMenuService);
  });

  describe('getChannelToken', () => {
    it('returns SHOP token when channel=shop', async () => {
      integrationConfig.getValue.mockImplementation((key, field) =>
        Promise.resolve(key === 'line-shop' && field === 'channelToken' ? 'shop-token-123' : null),
      );

      const token = await (service as any).getChannelToken('shop');

      expect(integrationConfig.getValue).toHaveBeenCalledWith('line-shop', 'channelToken');
      expect(token).toBe('shop-token-123');
    });

    it('returns FINANCE token when channel=finance', async () => {
      integrationConfig.getValue.mockImplementation((key, field) =>
        Promise.resolve(key === 'line-finance' && field === 'channelToken' ? 'finance-token-456' : null),
      );

      const token = await (service as any).getChannelToken('finance');

      expect(integrationConfig.getValue).toHaveBeenCalledWith('line-finance', 'channelToken');
      expect(token).toBe('finance-token-456');
    });

    it('throws BadRequestException when token not configured', async () => {
      integrationConfig.getValue.mockResolvedValue(null);

      await expect((service as any).getChannelToken('finance')).rejects.toThrow(BadRequestException);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest rich-menu.service.spec.ts
```

Expected: FAIL — `getChannelToken is not a function` or similar

- [ ] **Step 3: Replace `getShopChannelToken` with `getChannelToken` in service**

Edit `apps/api/src/modules/line-oa/rich-menu/rich-menu.service.ts` lines 51-53, replace:

```ts
  private async getShopChannelToken(): Promise<string> {
    return (await this.integrationConfig.getValue('line-shop', 'channelToken')) || '';
  }
```

with:

```ts
  private async getChannelToken(channel: 'shop' | 'finance' = 'shop'): Promise<string> {
    const key = channel === 'shop' ? 'line-shop' : 'line-finance';
    const token = await this.integrationConfig.getValue(key, 'channelToken');
    if (!token) {
      throw new BadRequestException(
        `LINE ${channel === 'shop' ? 'SHOP' : 'FINANCE'} channel token ยังไม่ถูกตั้งค่า — กรุณาไปที่ /settings/integrations`,
      );
    }
    return token;
  }

  /** @deprecated Use getChannelToken('shop') instead */
  private async getShopChannelToken(): Promise<string> {
    return this.getChannelToken('shop');
  }
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd apps/api && npx jest rich-menu.service.spec.ts
```

Expected: PASS — 3 tests passed

- [ ] **Step 5: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/line-oa/rich-menu/rich-menu.service.ts apps/api/src/modules/line-oa/rich-menu/rich-menu.service.spec.ts
git commit -m "feat(rich-menu): add channel-aware getChannelToken helper"
```

---

### Task 2: Backend — Propagate `channel` param through all LINE API methods

**Files:**
- Modify: `apps/api/src/modules/line-oa/rich-menu/rich-menu.service.ts`
- Modify: `apps/api/src/modules/line-oa/rich-menu/rich-menu.service.spec.ts`

- [ ] **Step 1: Add failing test for channel propagation in listRichMenus**

Append to `rich-menu.service.spec.ts` (inside the `describe('RichMenuService', ...)` block):

```ts
  describe('listRichMenus', () => {
    const originalFetch = global.fetch;
    afterEach(() => { global.fetch = originalFetch; });

    it('uses FINANCE token when channel=finance', async () => {
      integrationConfig.getValue.mockImplementation((key) =>
        Promise.resolve(key === 'line-finance' ? 'finance-token' : null),
      );
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ richmenus: [] }),
      });
      global.fetch = fetchMock as any;

      await service.listRichMenus('finance');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/richmenu/list'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer finance-token' }),
        }),
      );
    });

    it('defaults to SHOP token when channel omitted', async () => {
      integrationConfig.getValue.mockImplementation((key) =>
        Promise.resolve(key === 'line-shop' ? 'shop-token' : null),
      );
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ richmenus: [] }),
      });
      global.fetch = fetchMock as any;

      await service.listRichMenus();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer shop-token' }),
        }),
      );
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest rich-menu.service.spec.ts
```

Expected: FAIL — `listRichMenus` doesn't accept channel param, FINANCE test fails

- [ ] **Step 3: Update all service methods to accept `channel` param**

In `apps/api/src/modules/line-oa/rich-menu/rich-menu.service.ts`:

**3a.** Update `getDefaultRichMenuId` (around line 285):

```ts
  async getDefaultRichMenuId(channel: 'shop' | 'finance' = 'shop'): Promise<string | null> {
    const token = await this.getChannelToken(channel);
    const url = `${this.lineApiBaseUrl}/user/all/richmenu`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 404) return null;

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`Failed to get default Rich Menu: ${response.status} ${errorBody}`);
    }

    const data = await response.json();
    return (data as { richMenuId?: string }).richMenuId ?? null;
  }
```

**3b.** Update `uploadRichMenuImage` (around line 315):

```ts
  async uploadRichMenuImage(
    richMenuId: string,
    imageBuffer: Buffer,
    channel: 'shop' | 'finance' = 'shop',
  ): Promise<void> {
    const token = await this.getChannelToken(channel);
    const url = `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
      body: new Uint8Array(imageBuffer),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`Failed to upload Rich Menu image: ${response.status} ${errorBody}`);
    }
    this.logger.log(`Rich Menu image uploaded for ${richMenuId} (channel=${channel})`);
  }
```

**3c.** Update `setDefaultRichMenu` (around line 343):

```ts
  async setDefaultRichMenu(
    richMenuId: string,
    channel: 'shop' | 'finance' = 'shop',
  ): Promise<void> {
    const token = await this.getChannelToken(channel);
    const url = `${this.lineApiBaseUrl}/user/all/richmenu/${richMenuId}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`Failed to set default Rich Menu: ${response.status} ${errorBody}`);
    }
    this.logger.log(`Default Rich Menu set to ${richMenuId} (channel=${channel})`);
  }
```

**3d.** Update `deleteRichMenu` (around line 365):

```ts
  async deleteRichMenu(
    richMenuId: string,
    channel: 'shop' | 'finance' = 'shop',
  ): Promise<void> {
    const token = await this.getChannelToken(channel);
    const url = `${this.lineApiBaseUrl}/richmenu/${richMenuId}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`Failed to delete Rich Menu: ${response.status} ${errorBody}`);
    }
    this.logger.log(`Rich Menu deleted: ${richMenuId} (channel=${channel})`);
  }
```

**3e.** Update `listRichMenus` (around line 387):

```ts
  async listRichMenus(channel: 'shop' | 'finance' = 'shop'): Promise<unknown[]> {
    const token = await this.getChannelToken(channel);
    const url = `${this.lineApiBaseUrl}/richmenu/list`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new InternalServerErrorException(`Failed to list Rich Menus: ${response.status}`);
    }
    const data = await response.json();
    return data.richmenus || [];
  }
```

**3f.** Update `linkRichMenuToUser` (around line 408):

```ts
  async linkRichMenuToUser(
    userId: string,
    richMenuId: string,
    channel: 'shop' | 'finance' = 'shop',
  ): Promise<void> {
    const token = await this.getChannelToken(channel);
    const url = `${this.lineApiBaseUrl}/user/${userId}/richmenu/${richMenuId}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) return;
    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(
        `Failed to link Rich Menu to user ${userId}: ${response.status} ${errorBody}`,
      );
    }
    this.logger.log(`Rich Menu ${richMenuId} linked to user ${userId} (channel=${channel})`);
  }
```

**3g.** Update `unlinkRichMenuFromUser` (around line 437):

```ts
  async unlinkRichMenuFromUser(
    userId: string,
    channel: 'shop' | 'finance' = 'shop',
  ): Promise<void> {
    const token = await this.getChannelToken(channel);
    const url = `${this.lineApiBaseUrl}/user/${userId}/richmenu`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) return;
    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(
        `Failed to unlink Rich Menu from user ${userId}: ${response.status} ${errorBody}`,
      );
    }
    this.logger.log(`Rich Menu unlinked from user ${userId} (channel=${channel})`);
  }
```

**3h.** Update `callLineApi` private helper (around line 495) to accept channel:

```ts
  private async callLineApi(
    url: string,
    body: unknown,
    channel: 'shop' | 'finance' = 'shop',
  ): Promise<Response> {
    const token = await this.getChannelToken(channel);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`LINE API error ${response.status}: ${errorBody}`);
    }
    return response;
  }
```

**3i.** Update `createCustomRichMenu` signature (around line 189) to accept channel:

```ts
  async createCustomRichMenu(
    params: CreateMenuParams,
    channel: 'shop' | 'finance' = 'shop',
  ): Promise<{ richMenuId: string }> {
    // ... existing body unchanged until the final call ...

    const response = await this.callLineApi(`${this.lineApiBaseUrl}/richmenu`, body, channel);
    const data = await response.json();
    this.logger.log(`Custom Rich Menu created: ${data.richMenuId} (layout=${layout}, channel=${channel})`);
    return { richMenuId: data.richMenuId };
  }
```

**3j.** Update `switchRichMenu` (around line 477) to pass channel:

```ts
  async switchRichMenu(
    userId: string,
    isVerified: boolean,
    channel: 'shop' | 'finance',
  ): Promise<void> {
    const channelPart = channel === 'shop' ? 'shop' : 'finance';
    const statusPart = isVerified ? 'Verified' : 'Default';
    const key = `line.richMenu.${channelPart}${statusPart}`;

    const richMenuId = await this.getRichMenuIdFromConfig(key);
    if (!richMenuId) {
      this.logger.warn(`Rich Menu config not found for key "${key}" — skipping switch`);
      return;
    }

    await this.linkRichMenuToUser(userId, richMenuId, channel);
  }
```

**3k.** Also update `createShopRichMenu` and `createFinanceRichMenu` (legacy methods around lines 68 and 123) to pass channel explicitly:

In `createShopRichMenu`:
```ts
    const response = await this.callLineApi(`${this.lineApiBaseUrl}/richmenu`, richMenu, 'shop');
```

In `createFinanceRichMenu`:
```ts
    const response = await this.callLineApi(`${this.lineApiBaseUrl}/richmenu`, richMenu, 'finance');
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd apps/api && npx jest rich-menu.service.spec.ts
```

Expected: PASS — all 5 tests passed

- [ ] **Step 5: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

Expected: 0 errors (existing callers pass without channel → use default 'shop')

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/line-oa/rich-menu/rich-menu.service.ts apps/api/src/modules/line-oa/rich-menu/rich-menu.service.spec.ts
git commit -m "feat(rich-menu): propagate channel param through all LINE API methods"
```

---

### Task 3: Backend — Add alias management methods (`setRichMenuAlias`, `getRichMenuAliases`)

**Files:**
- Modify: `apps/api/src/modules/line-oa/rich-menu/rich-menu.service.ts`
- Modify: `apps/api/src/modules/line-oa/rich-menu/rich-menu.service.spec.ts`

- [ ] **Step 1: Add failing test for alias methods**

Append to `rich-menu.service.spec.ts`:

```ts
  describe('setRichMenuAlias', () => {
    it('writes SystemConfig with correct key for shop/default', async () => {
      const prismaUpsert = jest.fn().mockResolvedValue({});
      (service as any).prisma = {
        systemConfig: { upsert: prismaUpsert, findFirst: jest.fn() },
      };
      // Mock setDefaultRichMenu (variant=default triggers LINE API)
      const setDefaultSpy = jest.spyOn(service, 'setDefaultRichMenu').mockResolvedValue(undefined);

      await service.setRichMenuAlias('shop', 'default', 'rm-123');

      expect(prismaUpsert).toHaveBeenCalledWith({
        where: { key: 'line.richMenu.shopDefault' },
        create: { key: 'line.richMenu.shopDefault', value: 'rm-123' },
        update: { value: 'rm-123', deletedAt: null },
      });
      expect(setDefaultSpy).toHaveBeenCalledWith('rm-123', 'shop');
    });

    it('writes SystemConfig for finance/verified without calling setDefaultRichMenu', async () => {
      const prismaUpsert = jest.fn().mockResolvedValue({});
      (service as any).prisma = {
        systemConfig: { upsert: prismaUpsert, findFirst: jest.fn() },
      };
      const setDefaultSpy = jest.spyOn(service, 'setDefaultRichMenu').mockResolvedValue(undefined);

      await service.setRichMenuAlias('finance', 'verified', 'rm-456');

      expect(prismaUpsert).toHaveBeenCalledWith({
        where: { key: 'line.richMenu.financeVerified' },
        create: { key: 'line.richMenu.financeVerified', value: 'rm-456' },
        update: { value: 'rm-456', deletedAt: null },
      });
      expect(setDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe('getRichMenuAliases', () => {
    it('returns all 4 alias values with null for missing keys', async () => {
      const prismaFindFirst = jest.fn().mockImplementation(({ where }) => {
        if (where.key === 'line.richMenu.shopDefault') {
          return Promise.resolve({ value: 'rm-shop-default' });
        }
        if (where.key === 'line.richMenu.financeVerified') {
          return Promise.resolve({ value: 'rm-finance-verified' });
        }
        return Promise.resolve(null);
      });
      (service as any).prisma = {
        systemConfig: { findFirst: prismaFindFirst, upsert: jest.fn() },
      };

      const aliases = await service.getRichMenuAliases();

      expect(aliases).toEqual({
        shopDefault: 'rm-shop-default',
        shopVerified: null,
        financeDefault: null,
        financeVerified: 'rm-finance-verified',
      });
    });
  });
```

- [ ] **Step 2: Run tests to verify fail**

```bash
cd apps/api && npx jest rich-menu.service.spec.ts
```

Expected: FAIL — `setRichMenuAlias` / `getRichMenuAliases` not defined

- [ ] **Step 3: Implement both methods**

Add to `apps/api/src/modules/line-oa/rich-menu/rich-menu.service.ts` (before the closing `}` of the class):

```ts
  /**
   * Set Rich Menu alias for a channel/variant combination.
   * Writes SystemConfig key `line.richMenu.{channel}{Variant}`.
   * For variant='default', also calls LINE setDefaultRichMenu (new friends see this menu).
   */
  async setRichMenuAlias(
    channel: 'shop' | 'finance',
    variant: 'default' | 'verified',
    richMenuId: string,
  ): Promise<void> {
    const variantPart = variant === 'default' ? 'Default' : 'Verified';
    const key = `line.richMenu.${channel}${variantPart}`;

    await this.prisma.systemConfig.upsert({
      where: { key },
      create: { key, value: richMenuId },
      update: { value: richMenuId, deletedAt: null },
    });

    if (variant === 'default') {
      await this.setDefaultRichMenu(richMenuId, channel);
    }

    this.logger.log(`Rich Menu alias set: ${key} = ${richMenuId}`);
  }

  /**
   * Read all 4 Rich Menu aliases from SystemConfig.
   */
  async getRichMenuAliases(): Promise<{
    shopDefault: string | null;
    shopVerified: string | null;
    financeDefault: string | null;
    financeVerified: string | null;
  }> {
    const keys = [
      'line.richMenu.shopDefault',
      'line.richMenu.shopVerified',
      'line.richMenu.financeDefault',
      'line.richMenu.financeVerified',
    ];
    const records = await Promise.all(
      keys.map((key) =>
        this.prisma.systemConfig.findFirst({ where: { key, deletedAt: null } }),
      ),
    );
    return {
      shopDefault: records[0]?.value ?? null,
      shopVerified: records[1]?.value ?? null,
      financeDefault: records[2]?.value ?? null,
      financeVerified: records[3]?.value ?? null,
    };
  }
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd apps/api && npx jest rich-menu.service.spec.ts
```

Expected: PASS — all 7 tests passed

- [ ] **Step 5: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/line-oa/rich-menu/rich-menu.service.ts apps/api/src/modules/line-oa/rich-menu/rich-menu.service.spec.ts
git commit -m "feat(rich-menu): add setRichMenuAlias and getRichMenuAliases"
```

---

### Task 4: Backend — Create `SetAliasDto`

**Files:**
- Create: `apps/api/src/modules/line-oa/rich-menu/dto/set-alias.dto.ts`

- [ ] **Step 1: Create DTO file**

Create `apps/api/src/modules/line-oa/rich-menu/dto/set-alias.dto.ts`:

```ts
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class SetAliasDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุ channel' })
  @IsIn(['shop', 'finance'], { message: 'channel ต้องเป็น shop หรือ finance' })
  channel!: 'shop' | 'finance';

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุ variant' })
  @IsIn(['default', 'verified'], { message: 'variant ต้องเป็น default หรือ verified' })
  variant!: 'default' | 'verified';
}
```

- [ ] **Step 2: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/line-oa/rich-menu/dto/set-alias.dto.ts
git commit -m "feat(rich-menu): add SetAliasDto"
```

---

### Task 5: Backend — Add `channel` param to existing controller endpoints

**Files:**
- Modify: `apps/api/src/modules/line-oa/line-oa.controller.ts` (lines 238-327)

- [ ] **Step 1: Update imports and all 7 endpoints to accept channel**

Ensure `Query` is in the imports at the top of `line-oa.controller.ts`:

```ts
import { Query } from '@nestjs/common';
```

Replace the entire block from `@Get('rich-menu/list')` (line 240) through `@Delete('rich-menu/:id')` (ends around line 327) with:

```ts
  // ─── Rich Menu Management (Owner) ───────────────────
  // All endpoints accept ?channel=shop|finance (default: shop)

  @Get('rich-menu/list')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async listRichMenus(@Query('channel') channel?: string) {
    const ch = this.parseChannel(channel);
    const richmenus = await this.richMenuService.listRichMenus(ch);
    const defaultId = await this.richMenuService.getDefaultRichMenuId(ch).catch(() => null);
    return { richmenus, defaultRichMenuId: defaultId };
  }

  @Get('rich-menu/default')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async getDefaultRichMenu(@Query('channel') channel?: string) {
    const ch = this.parseChannel(channel);
    const richMenuId = await this.richMenuService.getDefaultRichMenuId(ch);
    return { richMenuId };
  }

  @Post('rich-menu/create-default')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async createDefaultRichMenu(
    @Body()
    body: {
      liffUrl?: string;
      name?: string;
      chatBarText?: string;
      layout?: string;
      buttons?: any[];
      channel?: string;
    },
  ) {
    const ch = this.parseChannel(body.channel);
    const result = await this.richMenuService.createCustomRichMenu(
      { ...body, layout: body.layout as '2x3' | '1x3' | '2x2' | undefined },
      ch,
    );
    return { success: true, richMenuId: result.richMenuId };
  }

  @Post('rich-menu/:id/upload-image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  @UseInterceptors(FileInterceptor('image'))
  async uploadRichMenuImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('channel') channel?: string,
  ) {
    if (!file) throw new BadRequestException('กรุณาอัปโหลดรูปภาพ');
    const ch = this.parseChannel(channel);
    await this.richMenuService.uploadRichMenuImage(id, file.buffer, ch);
    return { success: true, message: 'อัปโหลดรูป Rich Menu สำเร็จ' };
  }

  @Post('rich-menu/create-with-image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  @UseInterceptors(FileInterceptor('image'))
  async createWithImage(@UploadedFile() file: Express.Multer.File, @Body() body: any) {
    const config = typeof body.config === 'string' ? JSON.parse(body.config) : (body.config ?? {});
    const ch = this.parseChannel(config.channel);

    const result = await this.richMenuService.createCustomRichMenu(config, ch);

    if (file && result.richMenuId) {
      await this.richMenuService.uploadRichMenuImage(result.richMenuId, file.buffer, ch);
    }

    if (config.setAsDefault && result.richMenuId) {
      await this.richMenuService.setDefaultRichMenu(result.richMenuId, ch);
    }

    return { success: true, richMenuId: result.richMenuId };
  }

  @Post('rich-menu/:id/set-default')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async setDefaultRichMenu(@Param('id') id: string, @Query('channel') channel?: string) {
    const ch = this.parseChannel(channel);
    await this.richMenuService.setDefaultRichMenu(id, ch);
    return { success: true, message: 'ตั้งค่า Rich Menu เริ่มต้นเรียบร้อย' };
  }

  @Delete('rich-menu/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async deleteRichMenu(@Param('id') id: string, @Query('channel') channel?: string) {
    const ch = this.parseChannel(channel);
    await this.richMenuService.deleteRichMenu(id, ch);
    return { success: true, message: 'ลบ Rich Menu เรียบร้อย' };
  }

  private parseChannel(channel?: string): 'shop' | 'finance' {
    if (channel === 'finance') return 'finance';
    if (channel === 'shop' || channel === undefined || channel === '') return 'shop';
    throw new BadRequestException('channel ต้องเป็น shop หรือ finance');
  }
```

- [ ] **Step 2: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

Expected: 0 errors

- [ ] **Step 3: Run existing tests (no regression)**

```bash
cd apps/api && npx jest
```

Expected: PASS — all existing tests still pass (frontend not changed yet so default `channel='shop'` keeps behavior)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/line-oa/line-oa.controller.ts
git commit -m "feat(rich-menu): accept channel param on existing rich-menu endpoints"
```

---

### Task 6: Backend — Add new alias controller endpoints

**Files:**
- Modify: `apps/api/src/modules/line-oa/line-oa.controller.ts`

- [ ] **Step 1: Add 2 new endpoints at the end of the Rich Menu Management section**

After the `@Delete('rich-menu/:id')` endpoint but before `parseChannel` helper (or keep `parseChannel` last — just ensure these are inside the class), add:

```ts
  @Get('rich-menu/aliases')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async getRichMenuAliases() {
    return this.richMenuService.getRichMenuAliases();
  }

  @Post('rich-menu/:id/set-alias')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async setRichMenuAlias(@Param('id') id: string, @Body() dto: SetAliasDto) {
    await this.richMenuService.setRichMenuAlias(dto.channel, dto.variant, id);
    return { success: true, message: 'ตั้งค่า alias สำเร็จ' };
  }
```

Add import at top of file:

```ts
import { SetAliasDto } from './rich-menu/dto/set-alias.dto';
```

**Note:** `aliases` route must come BEFORE `:id` routes with same HTTP method — but since `aliases` is GET and `:id/set-alias` is POST, no conflict. However if any future `GET rich-menu/:id` is added, move `aliases` above it.

- [ ] **Step 2: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

Expected: 0 errors

- [ ] **Step 3: Run existing tests**

```bash
cd apps/api && npx jest
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/line-oa/line-oa.controller.ts
git commit -m "feat(rich-menu): add GET /aliases and POST /:id/set-alias endpoints"
```

---

### Task 7: Backend — Add `liffId` field to `line-finance` integration

**Files:**
- Modify: `apps/api/src/modules/integrations/integration-registry.ts` (lines 64-86)

- [ ] **Step 1: Add `liffId` field to `line-finance` fields array**

In `apps/api/src/modules/integrations/integration-registry.ts`, replace the `line-finance` entry (around lines 63-86):

```ts
  {
    key: 'line-finance',
    name: 'LINE FINANCE (น้องเบส)',
    description: 'ไลน์การเงิน — แจ้งค่างวด, รับชำระ',
    icon: 'line',
    webhookUrl: `${BASE}/api/chatbot/finance/webhook`,
    webhookNote: 'ตั้งค่า Webhook URL นี้ที่ LINE Developers Console → Messaging API → Webhook URL',
    fields: [
      {
        key: 'channelToken',
        label: 'Channel Access Token',
        sensitive: true,
        required: true,
        envVar: 'LINE_FINANCE_CHANNEL_ACCESS_TOKEN',
      },
      {
        key: 'channelSecret',
        label: 'Channel Secret',
        sensitive: true,
        required: true,
        envVar: 'LINE_FINANCE_CHANNEL_SECRET',
      },
      {
        key: 'liffId',
        label: 'LIFF ID',
        sensitive: false,
        required: false,
        envVar: 'VITE_LIFF_ID_FINANCE',
      },
    ],
  },
```

- [ ] **Step 2: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/integrations/integration-registry.ts
git commit -m "feat(integrations): add liffId field to line-finance"
```

---

### Task 8: Frontend — Add channel tab state + top-level tabs UI

**Files:**
- Modify: `apps/web/src/pages/RichMenuPage.tsx`

- [ ] **Step 1: Verify Tabs component exists**

```bash
ls /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/src/components/ui/tabs.tsx 2>&1
```

Expected: File exists (shadcn tabs component). If not, check for existing tab usage pattern:

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/src && grep -rn "TabsList\|TabsTrigger" --include="*.tsx" | head -3
```

If shadcn Tabs not installed, use the existing sub-tab pattern (border-b buttons) for the channel tabs instead.

- [ ] **Step 2: Add channel state and channel tabs at top of page render**

In `apps/web/src/pages/RichMenuPage.tsx`, inside the `RichMenuPage` function (after other `useState` declarations around line 322), add:

```ts
  const [channel, setChannel] = useState<'shop' | 'finance'>('shop');
```

Then in the JSX, right after `<PageHeader ... />` (around line 514) and before the existing sub-tabs div, insert:

```tsx
      {/* Channel tabs (top-level) */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {[
          { key: 'shop', label: '🛍 SHOP' },
          { key: 'finance', label: '💰 FINANCE' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setChannel(tab.key as 'shop' | 'finance')}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              channel === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/RichMenuPage.tsx
git commit -m "feat(rich-menu): add channel tabs (SHOP/FINANCE) to settings page"
```

---

### Task 9: Frontend — Channel-aware queries + FINANCE liffId source

**Files:**
- Modify: `apps/web/src/pages/RichMenuPage.tsx`

- [ ] **Step 1: Update `rich-menu-list` query to include channel in key**

In `apps/web/src/pages/RichMenuPage.tsx`, replace the existing `useQuery` for rich-menu-list (around lines 343-350):

```ts
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['rich-menu-list', channel],
    queryFn: async () => {
      const res = await api.get(`/line-oa/rich-menu/list?channel=${channel}`);
      return res.data as RichMenuListResponse;
    },
    retry: 1,
  });
```

- [ ] **Step 2: Add new query for FINANCE integration settings**

Right after the `lineSettings` query (around line 358), add:

```ts
  const { data: financeIntegration } = useQuery({
    queryKey: ['integration', 'line-finance'],
    queryFn: async () => {
      const res = await api.get('/integrations/line-finance');
      return res.data as { values: Record<string, string> };
    },
  });
```

**Note:** The exact endpoint path may differ — verify by:
```bash
grep -rn "@Get\|@Controller" /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/integrations/integrations.controller.ts | head -10
```
Adjust the path if needed (e.g. `/integrations/:key` or `/integrations?key=line-finance`).

- [ ] **Step 3: Add alias query**

Right after the `financeIntegration` query, add:

```ts
  const { data: aliases } = useQuery({
    queryKey: ['rich-menu-aliases'],
    queryFn: async () => {
      const res = await api.get('/line-oa/rich-menu/aliases');
      return res.data as {
        shopDefault: string | null;
        shopVerified: string | null;
        financeDefault: string | null;
        financeVerified: string | null;
      };
    },
  });
```

- [ ] **Step 4: Update `defaultLiffUrl` to resolve per channel**

Replace the existing `defaultLiffUrl` block (around lines 360-363):

```ts
  const shopLiffId = lineSettings?.settings?.liff_id;
  const financeLiffId = financeIntegration?.values?.liffId;
  const activeLiffId = channel === 'shop' ? shopLiffId : financeLiffId;
  const defaultLiffUrl = activeLiffId ? `https://liff.line.me/${activeLiffId}` : '';
  const effectiveLiffUrl = liffUrl || defaultLiffUrl;
```

- [ ] **Step 5: Reset liffUrl + editingMenuId when channel changes**

After the `setChannel` state declaration, add a `useEffect` that resets per-channel state on channel switch:

```ts
  useEffect(() => {
    setLiffUrl('');
    setEditingMenuId(null);
    setCustomImageFile(null);
    setCustomImagePreview(null);
  }, [channel]);
```

And ensure `useEffect` is imported from React at the top of the file:

```ts
import { useState, useRef, useEffect } from 'react';
```

- [ ] **Step 6: Verify build**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/RichMenuPage.tsx
git commit -m "feat(rich-menu): channel-aware queries and LIFF URL resolution"
```

---

### Task 10: Frontend — Channel-aware mutations + alias UI

**Files:**
- Modify: `apps/web/src/pages/RichMenuPage.tsx`

- [ ] **Step 1: Pass `channel` in all mutations**

Update `createMutation` (around lines 374-413):

In the `create-with-image` FormData section, add channel to the config JSON:

```ts
        fd.append(
          'config',
          JSON.stringify({
            name: menuName,
            chatBarText,
            liffUrl: effectiveLiffUrl,
            layout,
            buttons: visibleButtons,
            setAsDefault: true,
            channel,  // ← add this line
          }),
        );
```

In the standard `create-default` JSON body, add channel:

```ts
      const res = await api.post('/line-oa/rich-menu/create-default', {
        liffUrl: effectiveLiffUrl,
        name: menuName,
        chatBarText,
        layout,
        buttons: visibleButtons,
        channel,  // ← add this line
      });
```

Update `setDefaultMutation` (around lines 439-448):

```ts
  const setDefaultMutation = useMutation({
    mutationFn: async (menuId: string) => {
      await api.post(`/line-oa/rich-menu/${menuId}/set-default?channel=${channel}`);
    },
    onSuccess: () => {
      toast.success('ตั้งเป็น Default แล้ว');
      queryClient.invalidateQueries({ queryKey: ['rich-menu-list', channel] });
      queryClient.invalidateQueries({ queryKey: ['rich-menu-aliases'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
```

Update `deleteMutation`:

```ts
  const deleteMutation = useMutation({
    mutationFn: async (menuId: string) => {
      await api.delete(`/line-oa/rich-menu/${menuId}?channel=${channel}`);
    },
    onSuccess: () => {
      toast.success('ลบ Rich Menu แล้ว');
      queryClient.invalidateQueries({ queryKey: ['rich-menu-list', channel] });
      queryClient.invalidateQueries({ queryKey: ['rich-menu-aliases'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
```

Update `uploadImageMutation`:

```ts
  const uploadImageMutation = useMutation({
    mutationFn: async ({ menuId, file }: { menuId: string; file: File }) => {
      const formData = new FormData();
      formData.append('image', file);
      await api.post(`/line-oa/rich-menu/${menuId}/upload-image?channel=${channel}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      toast.success('อัปโหลดรูป Rich Menu สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['rich-menu-list', channel] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
```

Also update the cleanup of old menu in `createMutation.onSuccess` (around lines 418-431):

```ts
      if (editingMenuId) {
        const oldMenuId = editingMenuId;
        try {
          if (data?.richMenuId) {
            await api.post(`/line-oa/rich-menu/${data.richMenuId}/set-default?channel=${channel}`);
          }
          await api.delete(`/line-oa/rich-menu/${oldMenuId}?channel=${channel}`);
        } catch (err) {
          console.error('Failed to cleanup old menu', err);
        }
        setEditingMenuId(null);
      }

      queryClient.invalidateQueries({ queryKey: ['rich-menu-list', channel] });
      queryClient.invalidateQueries({ queryKey: ['rich-menu-aliases'] });
```

- [ ] **Step 2: Add `setAliasMutation`**

After `uploadImageMutation`, add:

```ts
  const setAliasMutation = useMutation({
    mutationFn: async ({ menuId, variant }: { menuId: string; variant: 'default' | 'verified' }) => {
      await api.post(`/line-oa/rich-menu/${menuId}/set-alias`, { channel, variant });
    },
    onSuccess: (_, vars) => {
      toast.success(`ตั้งเป็น ${vars.variant === 'default' ? 'Default' : 'Verified'} แล้ว`);
      queryClient.invalidateQueries({ queryKey: ['rich-menu-aliases'] });
      queryClient.invalidateQueries({ queryKey: ['rich-menu-list', channel] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
```

- [ ] **Step 3: Replace "ตั้งเป็น Default" button with alias dropdown**

In the menu card render (around lines 776-786), replace the conditional "ตั้งเป็น Default" `<Button>` block with a dropdown:

First, import DropdownMenu components at the top of the file (check if file already imports them):

```bash
grep "DropdownMenu" /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/src/pages/RichMenuPage.tsx
```

If not present, verify the shadcn component exists:
```bash
ls /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/src/components/ui/dropdown-menu.tsx
```

Then add to imports:

```ts
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
```

Replace the existing `{!isDefault && <Button ...>ตั้งเป็น Default</Button>}` block with:

```tsx
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline">
                              <Star size={13} className="mr-1" />
                              ตั้งเป็น...
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                setAliasMutation.mutate({ menuId: menu.richMenuId, variant: 'default' })
                              }
                            >
                              ⭐ Default (ลูกค้าใหม่)
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                setAliasMutation.mutate({ menuId: menu.richMenuId, variant: 'verified' })
                              }
                            >
                              ✓ Verified (ลูกค้าที่ verify แล้ว)
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
```

- [ ] **Step 4: Show Default / Verified badges per alias assignment**

Still inside the menu card render, update the `isDefault` computation logic. Replace (around line 749):

```ts
              const isDefault = menu.richMenuId === data.defaultMenuId;
```

with:

```ts
              const channelAliases = aliases
                ? {
                    default: channel === 'shop' ? aliases.shopDefault : aliases.financeDefault,
                    verified: channel === 'shop' ? aliases.shopVerified : aliases.financeVerified,
                  }
                : { default: null, verified: null };
              const isDefault = menu.richMenuId === channelAliases.default;
              const isVerified = menu.richMenuId === channelAliases.verified;
```

Then in the badge render section (around lines 769-773), replace:

```tsx
                        {isDefault && (
                          <Badge className="bg-success/10 text-success hover:bg-success/10 border-success/30 shrink-0">
                            Default
                          </Badge>
                        )}
```

with:

```tsx
                        {isDefault && (
                          <Badge className="bg-success/10 text-success hover:bg-success/10 border-success/30 shrink-0">
                            ⭐ Default
                          </Badge>
                        )}
                        {isVerified && (
                          <Badge className="bg-primary/10 text-primary hover:bg-primary/10 border-primary/30 shrink-0">
                            ✓ Verified
                          </Badge>
                        )}
```

Also update the card border condition so it highlights when EITHER alias matches (around line 753):

```tsx
                <div
                  key={menu.richMenuId}
                  className={`rounded-xl border shadow-sm hover:shadow-md transition-shadow bg-card overflow-hidden ${
                    isDefault || isVerified ? 'border-success/30' : 'border-border/50'
                  }`}
                >
                  <div className={`px-5 py-3 ${isDefault || isVerified ? 'bg-success/10' : 'bg-muted/20'}`}>
```

And the Star icon:

```tsx
                        {(isDefault || isVerified) && (
                          <Star size={16} className="text-success shrink-0" fill="currentColor" />
                        )}
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/RichMenuPage.tsx
git commit -m "feat(rich-menu): alias dropdown + badges, channel-aware mutations"
```

---

### Task 11: Final verification — full type check + run all tests

**Files:** none — verification only

- [ ] **Step 1: Full TypeScript check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh all
```

Expected: 0 errors (both api + web)

- [ ] **Step 2: Run full API test suite**

```bash
cd apps/api && npx jest
```

Expected: PASS — all tests including existing 577 + new rich-menu.service tests

- [ ] **Step 3: Run web tests**

```bash
cd apps/web && npx vitest run
```

Expected: PASS — existing 129 tests still pass

- [ ] **Step 4: Lint**

```bash
cd apps/api && npm run lint
cd ../web && npm run lint
```

Expected: 0 errors

- [ ] **Step 5: Manual QA checklist (to be run against dev server)**

Start dev server:

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && npm run dev
```

Then verify in browser:

1. Navigate to http://localhost:5173/settings/integrations → configure `line-finance.channelToken` (if not yet set) and `line-finance.liffId`
2. Navigate to http://localhost:5173/settings/rich-menu
3. ✅ See two tabs: `🛍 SHOP` and `💰 FINANCE` at top
4. ✅ SHOP tab selected by default
5. Switch to FINANCE tab → list is empty initially (fresh FINANCE channel)
6. Create a menu in FINANCE tab → verify toast success + menu appears in list
7. On menu card, click "ตั้งเป็น..." → select "Default" → toast success, `⭐ Default` badge appears
8. Reload page → FINANCE tab still shows menu with Default badge
9. Switch to SHOP tab → menu from step 7 does NOT appear (scoped to FINANCE)
10. Create another menu in FINANCE tab → set it as `Verified` → `✓ Verified` badge appears
11. Verify LINE Developers Console → FINANCE channel shows 2 menus, SHOP channel unaffected

- [ ] **Step 6: Final commit (if any cleanup needed)**

If manual QA revealed small issues, fix and commit. Otherwise skip.

```bash
# Only if changes made during QA
git add -A
git commit -m "fix(rich-menu): address manual QA findings"
```

---

## Self-Review Summary

**Spec coverage check:**
- §4.1 Channel resolution → Task 1, 2 ✓
- §4.2 SystemConfig alias keys → Task 3 ✓
- §4.3 Data flow → covered by existing `switchRichMenu` callers (out of scope per spec §3) + Task 3 alias writing
- §5.1 Method signatures → Task 2 ✓
- §5.2 setRichMenuAlias → Task 3 ✓
- §5.3 getRichMenuAliases → Task 3 ✓
- §5.4 Controller endpoints → Task 5 (existing), Task 6 (new) ✓
- §5.5 Integration registry → Task 7 ✓
- §6 Frontend → Task 8, 9, 10 ✓
- §7 Testing strategy → Task 1, 2, 3 (unit) + Task 11 (integration + manual) ✓
- §9 Risks — token-not-configured → Task 1 Step 3 (BadRequestException with Thai message) ✓
- §9 Risks — alias points to deleted menu → **Deferred to future work** (listed as post-MVP — user can re-assign)
- §9 Risks — LIFF per channel → Task 9 ✓
- §9 Risks — channel change mid-edit → Task 9 Step 5 (useEffect resets state on channel change) ✓

**Placeholder scan:** No TBD/TODO/placeholders. All steps include exact code or exact commands.

**Type consistency:** `channel: 'shop' | 'finance'` used consistently. Service method names match throughout (`setRichMenuAlias`, `getRichMenuAliases`, `getChannelToken`).
