import { randomUUID } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { RoomManagerService } from '../src/modules/chat-engine/services/room-manager.service';
import { StorageService } from '../src/modules/storage/storage.service';
if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) throw new Error('Use disposable harness');
it('cross-channel previews reload grants and never reveal another company or another sales owner', async () => {
 const db=new PrismaService(); const manager=new RoomManagerService(db,{} as StorageService);
 try {
  const branch=await db.branch.create({data:{name:'Scoped related rooms'}});
  const actor=await db.user.create({data:{name:'Scoped',email:`${randomUUID()}@scope.invalid`,password:'unused',role:'SALES',branchId:branch.id,accessibleCompanies:['SHOP']}});
  const other=await db.user.create({data:{name:'Other',email:`${randomUUID()}@scope.invalid`,password:'unused',role:'SALES',branchId:branch.id,accessibleCompanies:['SHOP']}});
  const customer=await db.customer.create({data:{name:'Related scoped'}});
  const room=await db.chatRoom.create({data:{channel:'FACEBOOK',assignedToId:actor.id,customerId:customer.id}});
  await db.chatRoom.create({data:{channel:'LINE_FINANCE',customerId:customer.id}});
  await db.chatRoom.create({data:{channel:'FACEBOOK',assignedToId:other.id,customerId:customer.id}});
  // Call through a runtime signature so RED demonstrates the leak in the current implementation.
  const read=manager.getCrossChannelRooms.bind(manager) as (id:string,actor:{id:string},scope:{company:'SHOP'})=>Promise<{id:string}[]>;
  expect((await read(room.id,actor,{company:'SHOP'})).map(r=>r.id)).toEqual([room.id]);
  await db.user.update({where:{id:actor.id},data:{accessibleCompanies:['FINANCE']}});
  await expect(read(room.id,actor,{company:'SHOP'})).rejects.toThrow();
 }finally{await db.$disconnect();}
});

import { SessionOpsService } from '../src/modules/staff-chat/services/session-ops.service';
it('legacy create-ticket cannot copy a room outside current company grants', async () => {
 const db=new PrismaService();
 try {
  const user=await db.user.create({data:{name:'Finance only',email:`${randomUUID()}@scope.invalid`,password:'unused',role:'OWNER',accessibleCompanies:['FINANCE']}});
  const room=await db.chatRoom.create({data:{channel:'FACEBOOK'}});
  await db.chatMessage.create({data:{roomId:room.id,role:'CUSTOMER',text:'Private shop text'}});
  await expect(new SessionOpsService(db).createTicketFromRoom(room.id,user.id)).rejects.toThrow();
 }finally{await db.$disconnect();}
});
