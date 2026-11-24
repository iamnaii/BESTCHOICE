import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Explicit opt-in integration check: only this checkout's disposable preview. */
export async function checkEmployeeAccessApi(origin) {
  const parsed = new URL(origin);
  assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname), 'Loopback preview required');
  const call = async (path, method = 'GET', body, status = 200) => {
    const response = await fetch(`${parsed.origin}/api/${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  const info = await call('preview/info');
  assert.equal(info.isolated, true);
  assert.equal(realpathSync(info.repoRoot), realpathSync(resolve(fileURLToPath(new URL('..', import.meta.url)))));
  await call('preview/actor/owner', 'POST', {}, 201);
  const base = 'employee-access';
  try {
    const fixture = await call('preview/employee-access-fixture', 'POST', {}, 201);
    const context = await call(`${base}/context`);
    const branch = context.branches.find(b => b.name === 'สาขาทดสอบสิทธิ์ A');
    assert.ok(branch, 'Dedicated access fixture required');
    const employees = await call(`${base}/employees`);
    const employee = employees.find(e => e.id === fixture.employee.id);
    assert.ok(employee);
    const code = `LOCAL_ACCESS_${Date.now()}`;
    const position = await call(`${base}/positions`, 'POST', {
      code, name: `ตรวจสิทธิ์ ${code}`, permissions: ['products.read', 'products.update'],
    }, 201);
    const payload = { expectedRevision: employee.accessRevision, assignments: [{
      positionId: position.id, company: 'SHOP', scope: 'BRANCHES', branchIds: [branch.id],
    }] };
    const changed = await call(`${base}/employees/${employee.id}/assignments`, 'PUT', payload);
    assert.equal(changed.managed, true);
    assert.equal(changed.removedLegacyGrants.canReverseOverride, true);
    const savedEmployee = (await call(`${base}/employees`)).find(e => e.id === employee.id);
    assert.equal(savedEmployee.canReverseOverride, null);
    assert.equal(changed.grants.length, 1);
    assert.deepEqual(changed.grants[0].branchIds, [branch.id]);
    assert.ok(changed.grants[0].permissions.includes('products.update'));
    await call(`${base}/employees/${employee.id}/assignments`, 'PUT', payload, 409);
    await call(`${base}/positions/${position.id}`, 'PATCH', {
      expectedRevision: position.revision, permissions: ['products.read'],
    });
    const effective = await call(`${base}/employees/${employee.id}/effective-access`);
    assert.ok(effective.revision > changed.revision, 'Position edit invalidates staff revision');
    assert.equal(effective.grants.some(g => g.permissions.includes('products.update')), false);
    const history = await call(`${base}/history?limit=50&page=1`);
    assert.ok(history.items.some(e => e.entityId === position.id && e.action === 'ACCESS_POSITION_UPDATED'));
    assert.ok(history.items.some(e => e.entityId === employee.id && e.action === 'ACCESS_ASSIGNMENTS_REPLACED'));
    await call(`${base}/history?limit=51`, 'GET', undefined, 400);
    const owner = employees.find(e => e.id === info.previewActors.owner.id);
    await call(`${base}/employees/${owner.id}/assignments`, 'PUT', {
      expectedRevision: owner.accessRevision, assignments: [],
    }, 403);
    await call('preview/actor/receiver', 'POST', {}, 201);
    await call(`${base}/context`, 'GET', undefined, 403);
    await call(`${base}/history`, 'GET', undefined, 403);
    await call(`${base}/positions`, 'POST', { code: `${code}_FORGED`, name: 'forged', permissions: [] }, 403);
    return { positionId: position.id, employeeId: employee.id, branchId: branch.id,
      verified: ['persisted assignment', 'stale revision', 'revocation', 'history', 'owner protection', 'non-owner denial'],
      simulated: ['authentication identity supplied by isolated preview; production JWT login not tested'] };
  } finally {
    await call('preview/actor/owner', 'POST', {}, 201);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await checkEmployeeAccessApi(process.argv[2] || 'http://localhost:5216'), null, 2));
}
