# Pre-Merge Guard Report

| Field | Value |
|-------|-------|
| **Branch** | `fix/customer-references-transform-bypass` |
| **Author** | Akenarin Kongdach (akenarin.ak@gmail.com) |
| **Review Date** | 2026-04-17 |
| **Reviewer** | Pre-Merge Guard (automated) |
| **Recommendation** | ✅ APPROVE |

---

## Summary

Single-file fix to prevent the `references` field in `CreateCustomerDto` / `UpdateCustomerDto` from being silently stripped by NestJS's `ValidationPipe` whitelist. The field holds freeform `Record<string, unknown>[]` (references/guarantors), which class-transformer was coercing to `{}` on deserialization.

**Files changed:** 1 (`apps/api/src/modules/customers/dto/customer.dto.ts`) | **+3 / −1 lines**

---

## Changes

```diff
// apps/api/src/modules/customers/dto/customer.dto.ts

-import { Type } from 'class-transformer';
+import { Transform, Type } from 'class-transformer';

 @IsArray()
 @IsOptional()
+@Transform(({ value }) => value, { toClassOnly: true })
 references?: Record<string, unknown>[];
```

Same `@Transform` added to both `CreateCustomerDto` and `UpdateCustomerDto`.

---

## Analysis

The `@Transform(({ value }) => value, { toClassOnly: true })` decorator is a no-op transform — it returns the value unchanged. Its purpose is to register the field with class-transformer so the whitelist stripping does not discard it. `@IsArray()` and `@IsOptional()` decorators remain in place, so validation still enforces the array type.

**Security consideration:** The field is typed as `Record<string, unknown>[]` — arbitrary JSON objects. This is intentional (guarantor data has no fixed schema). The field is not used in any financial computation. No SQL injection risk (Prisma parameterizes all inputs).

---

## Issues Found

None.

---

## Security Checklist

| Check | Result |
|-------|--------|
| Missing `@UseGuards(JwtAuthGuard)` on new controllers | ✅ No controllers changed |
| `Number()` on financial fields | ✅ Not applicable |
| Missing `deletedAt: null` in new queries | ✅ Not applicable |
| Hardcoded secrets | ✅ None |
| Missing `@Roles()` | ✅ Not applicable |
| Unparameterized `$queryRaw` | ✅ None |

---

## Recommendation

**APPROVE** — Minimal, safe fix. No security or correctness concerns. Ready to merge.
