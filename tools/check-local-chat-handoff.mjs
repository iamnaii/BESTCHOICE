import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from '@playwright/test';
export async function checkChatHandoff(http, origin) {
  const info = await (await http.get(`${origin}/api/preview/info`)).json(); assert.equal(info.isolated,true);
  const actor = await (await http.get(`${origin}/api/auth/me`)).json(); const roomId = info.chatWorkRooms.SHOP;
  const base = `${origin}/api/staff-chat`;
  const input = { title: 'งานฝากทดสอบ API', assigneeId: actor.id, dueAt: '2026-11-01T10:00:00+07:00', clientRequestId: randomUUID(), note: 'ทดสอบกับข้อมูลจำลอง' };
  const created = await http.post(`${base}/rooms/${roomId}/handoffs?company=SHOP`,{ data: input }); assert.equal(created.status(),201); const task = await created.json();
  const premature = await http.patch(`${base}/handoffs/${task.id}?company=SHOP`,{ data: { expectedRevision: 0, action: 'COMPLETE' } }); assert.equal(premature.status(),409);
  const generic = await http.patch(`${origin}/api/todos/${task.id}?company=SHOP`,{ data: { expectedRevision: 0, status: 'DONE' } }); assert.equal(generic.status(),403);
  const accepted = await http.patch(`${base}/handoffs/${task.id}?company=SHOP`,{ data: { expectedRevision: 0, action: 'ACCEPT' } }); assert.equal(accepted.status(),200);
  const finished = await http.patch(`${base}/handoffs/${task.id}?company=SHOP`,{ data: { expectedRevision: 1, action: 'COMPLETE', completionNote: 'ทดสอบสำเร็จ' } }); assert.equal(finished.status(),200); assert.equal((await finished.json()).status,'DONE');
  const comments = await http.get(`${origin}/api/todos/${task.id}/comments?company=SHOP`); assert.equal(comments.status(),200); assert.equal((await comments.json())[0].content,'ทดสอบสำเร็จ');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const http = await request.newContext();
  try { await checkChatHandoff(http,process.env.LOCAL_CHAT_ORIGIN || 'http://localhost:5217'); console.log('PASS: handoff create/accept/complete and generic-route guard'); }
  finally { await http.dispose(); }
}
