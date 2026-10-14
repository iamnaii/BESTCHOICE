import { chooseComposerMode, openComposerTool, showWorkControl, toggleChatTheme } from './chat-ui.mjs';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';
export async function checkChatLibrary(page,origin,output,width){
 page.setDefaultTimeout(15000);const api=path=>`${origin}/api/admin/${path}`;
 const info=await (await page.request.get(api('preview/info'))).json();assert.equal(info.isolated,true);
 await page.request.post(api('preview/actor/owner'));
 // Each run owns a fresh synthetic room; retained preview files must not exhaust the real 10-file limit.
 const created=await page.request.post(api('preview/fixture'));assert.equal(created.status(),201);
 const {roomId:room}=await created.json();
 const name=`โปรโมชั่นมือถือ-${width}-${Date.now()}.png`;
 await page.goto(`${origin}/inbox/${room}?zone=shop`);
 await openComposerTool(page, 'เลือกไฟล์จากคลัง');
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:'คลังไฟล์ในระบบ',exact:true})).toBeVisible();
 const folder=`โฟลเดอร์ ${width} ${Date.now()}`;
 await dialog.getByLabel('สร้างโฟลเดอร์',{exact:true}).fill(folder);
 const [folderCreated]=await Promise.all([
  page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith('/staff-chat/library/folders')),
  dialog.getByRole('button',{name:'เพิ่มโฟลเดอร์',exact:true}).click(),
 ]);assert.ok(folderCreated.ok(),'Folder creation failed');
 // Retained synthetic folders can span pages. Follow the real folder paginator;
 // do not assume a newly created name sorts onto the first page.
 const folders=dialog.locator('aside').filter({has:page.getByRole('heading',{name:'โฟลเดอร์',exact:true})});
 let found=false;
 for(let folderPage=1;folderPage<=100;folderPage++){
  const response=await page.request.get(api('staff-chat/library/folders'),{params:{company:'SHOP',page:folderPage,limit:20}});
  assert.ok(response.ok(),'Folder page failed to load');
  const listing=await response.json();assert.equal(listing.page,folderPage);
  assert.ok(listing.data.length>0,'Created folder is missing from the library');
  await expect(folders.getByRole('button',{name:listing.data[0].name,exact:true})).toBeVisible();
  await expect(folders.getByRole('alert')).toHaveCount(0);
  if(listing.data.some(item=>item.name===folder)){
   await folders.getByRole('button',{name:folder,exact:true}).click();found=true;break;
  }
  assert.ok(folderPage*listing.limit<listing.total,'Created folder was not found');
  const next=folders.getByRole('button',{name:'ถัดไป',exact:true});await expect(next).toBeEnabled();await next.click();
 }
 assert.ok(found,'Folder pagination exceeded the test bound');
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
 await dialog.getByLabel('อัปโหลดเข้าคลังไฟล์',{exact:true}).setInputFiles({name,mimeType:'image/png',buffer:bytes});
 await dialog.getByLabel('ค้นหาไฟล์',{exact:true}).fill(name);
 const tile=dialog.getByRole('checkbox',{name:`เลือก ${name}`,exact:true});await expect(tile).toBeVisible();await tile.focus();await page.keyboard.press('Space');await expect(tile).toHaveAttribute('aria-checked','true');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Library overflow');
 await page.screenshot({path:join(output,`chat-library-${width}.png`),animations:'disabled'});
 const count=async()=>(await(await page.request.get(api('preview/library/sent'))).json()).count;
 const before=await count();await dialog.getByRole('button',{name:'เพิ่มไฟล์ที่เลือก',exact:true}).click();
 await expect(page.locator('[data-library-staged]')).toContainText(name);assert.equal(await count(),before,'Staging must not send');
 await chooseComposerMode(page, 'note');await expect(page.getByRole('button',{name:'ส่งไฟล์ที่เลือก',exact:true})).toBeHidden();assert.equal(await count(),before);
 await chooseComposerMode(page, 'chat');
 await page.request.post(api('preview/library/next'),{data:{result:'FAILED'}});
 await page.getByRole('button',{name:'ส่งไฟล์ที่เลือก',exact:true}).click();await expect(page.locator('[data-library-staged]')).toContainText('ไม่สำเร็จ · ลองใหม่ได้');
 await page.getByRole('button',{name:'ส่งไฟล์ที่เลือก',exact:true}).click();await expect(page.locator('[data-library-staged]')).toContainText('ส่งสำเร็จ');assert.equal(await count(),before+2);
 await expect(page.getByRole('button',{name:'ส่งไฟล์ที่เลือก',exact:true})).toBeDisabled();
 // Existing reply tools remain available after adding the library entry.
 await openComposerTool(page, 'อิโมจิ / สติกเกอร์');await expect(page.getByRole('button',{name:'😊 Emoji',exact:true})).toBeVisible();await page.keyboard.press('Escape');
 await openComposerTool(page, 'ส่งข้อมูลสินค้า');await expect(page.getByPlaceholder('ค้นหาชื่อรุ่น / ยี่ห้อ / IMEI')).toBeVisible();await page.getByPlaceholder('ค้นหาชื่อรุ่น / ยี่ห้อ / IMEI').fill('iPhone');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'ข้อความสำเร็จรูป',exact:true}).click();await page.getByRole('textbox', { name: 'ค้นหาข้อความสำเร็จรูป', exact: true }).fill('ขอบคุณ (ตัวอย่าง)');await page.getByText('ขอบคุณ (ตัวอย่าง)',{exact:true}).click();await page.getByRole('button',{name:'ใส่ข้อความ',exact:true}).click();await expect(page.getByRole('textbox',{name:'พิมพ์ข้อความ',exact:true})).toHaveValue('ขอบคุณที่สนใจ BESTCHOICE ครับ');
 if(width<1280)await page.getByRole('button',{name:'ข้อมูลลูกค้า',exact:true}).click();
 await page.getByRole('button',{name:'เลือกจากคลังไฟล์',exact:true}).click();await page.getByRole('dialog').getByLabel('ค้นหาไฟล์',{exact:true}).fill(name);await page.getByRole('dialog').getByRole('checkbox',{name:`เลือก ${name}`,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'เพิ่มไฟล์ที่เลือก',exact:true}).click();
 // A local upload changes the empty credit card into a file list. The staged
 // cloud draft must stay mounted across that transition (and keep its retry key).
 await page.locator('aside[aria-label="ข้อมูลลูกค้า"]:visible').getByLabel('เลือกสเตทเม้นเพื่อตรวจเครดิต',{exact:true}).setInputFiles({name:`local-${name}`,mimeType:'image/png',buffer:bytes});
 await expect(page.locator('aside[aria-label="ข้อมูลลูกค้า"]:visible').getByText('Statement 1',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'เพิ่มในตรวจเครดิต',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'เพิ่มในตรวจเครดิต',exact:true}).click();await expect(page.getByText('เพิ่มในตรวจเครดิตแล้ว',{exact:true})).toBeVisible();assert.equal(await count(),before+2,'Credit copy must not send');
 if(width<1280)await page.keyboard.press('Escape');
 await page.screenshot({path:join(output,`chat-library-staged-${width}.png`),animations:'disabled'});
 await page.goto(`${origin}/inbox/${info.chatWorkRooms.FINANCE}?zone=fin`);
 await openComposerTool(page, 'อิโมจิ / สติกเกอร์');await expect(page.getByRole('button',{name:'📦 สติกเกอร์',exact:true})).toBeVisible();await page.keyboard.press('Escape');
 await page.goto(`${origin}/inbox?zone=shop`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const browser=await chromium.launch({headless:true});try{for(const width of [1440,390]){const context=await browser.newContext({viewport:{width,height:1000}});await context.routeWebSocket('**/socket.io/**',s=>s.close());const page=await context.newPage();await checkChatLibrary(page,process.env.LOCAL_CHAT_ORIGIN||'http://localhost:5217','.tmp/local-preview',width);await context.close();}console.log('PASS: library folders/search/keyboard staging, failed send retry, note separation, credit copy and original composer tools 1440/390');}finally{await browser.close();}
}
