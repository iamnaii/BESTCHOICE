import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from '@playwright/test';
export async function checkChatNotes(http, origin) {
  const info = await (await http.get(`${origin}/api/preview/info`)).json(); assert.equal(info.isolated, true);
  const user = await (await http.get(`${origin}/api/auth/me`)).json();
  const roomId = info.chatWorkRooms.SHOP;
  const endpoint = `${origin}/api/staff-chat/rooms/${roomId}/notes`;
  const input = { content: 'โน้ตทดสอบ API ภายใน', mentionedUserIds: [user.id], clientRequestId: randomUUID() };
  const replies = await Promise.all([http.post(`${endpoint}?company=SHOP`, { data: input }), http.post(`${endpoint}?company=SHOP`, { data: input })]);
  for (const reply of replies) assert.equal(reply.status(), 201);
  const [first, retry] = await Promise.all(replies.map(reply => reply.json())); assert.equal(first.id,retry.id);
  const listing = await http.get(`${endpoint}?company=SHOP`); assert.equal(listing.status(),200);
  const note = (await listing.json()).find(item => item.id === first.id); assert.equal(note.mentions[0].userId,user.id);
  const wrong = await http.get(`${endpoint}?company=FINANCE`); assert.equal(wrong.status(),404);
  const pin = await http.patch(`${endpoint}/${first.id}/pin?company=SHOP`); assert.equal(pin.status(),200);
  const remove = await http.delete(`${endpoint}/${first.id}?company=SHOP`); assert.equal(remove.status(),200);
  const target = await http.get(`${origin}/api/staff-chat/work-targets/NOTE/${first.id}?company=SHOP`); assert.equal(target.status(),404);
  const inbox = await (await http.get(`${origin}/api/staff-chat/work-notifications?company=SHOP&limit=100`)).json();
  assert.equal(inbox.data.find(item => item.targetId === first.id).title,'โน้ตถูกลบ');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const http = await request.newContext();
  try { await checkChatNotes(http, process.env.LOCAL_CHAT_ORIGIN || 'http://localhost:5217'); console.log('PASS: actual note DTO/CRUD, scoped mentions, retry and deleted deep link'); }
  finally { await http.dispose(); }
}
