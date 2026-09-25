import { escapeHtml, escapeJsonForScript } from '../../shop-catalog/share-page.util';
import type { ExternalFinanceApplicationStatus, ExternalFinanceDocSlot } from '@prisma/client';

export interface SharePageFile { id: string; mimeType: string; size: number; originalName: string | null; url: string }
export interface SharePageGroup { slot: ExternalFinanceDocSlot; label: string; files: SharePageFile[] }
export interface SharePageInput {
  nonce: string; number: string; status: ExternalFinanceApplicationStatus; expiresAt: Date;
  messageText: string; groups: SharePageGroup[]; zipUrl: string; replyUrl: string; fileCount: number; lineGroupName: string;
}

export const LINE_GROUP_NAME = 'GFIN : BESTCHOICE (67301219)';
const OPEN_FOR_REPLY: ExternalFinanceApplicationStatus[] = ['SENT', 'ACKNOWLEDGED', 'MORE_INFO'];
const RESULT_LABEL: Partial<Record<ExternalFinanceApplicationStatus, string>> = {
  APPROVED: 'ผ่าน (แจ้งผ่านลิงก์)', REJECTED: 'ไม่ผ่าน', CANCELLED: 'ร้านยกเลิกใบยื่นนี้แล้ว',
};

const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtThaiDate = (d: Date) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

// ทุก style ต้องเป็นคลาส/ID selector ในบล็อกนี้เท่านั้น — ห้ามมี style="" บน element หรือ
// element.style.x = ... ใน <script> เพราะ CSP ของหน้านี้ (finance-share-public.controller.ts)
// เป็น style-src 'nonce-...' โดยไม่มี 'unsafe-inline' — nonce ใช้ได้เฉพาะกับ <style>/<script>
// element ไม่ครอบคลุม style attribute หรือการเซ็ต .style ผ่าน CSSOM (fix round 1 Important 4)
const CSS = `
:root{--p:#0B7A55;--bg:#F9F8F6;--card:#FDFCFB;--bd:#E4E1DD;--tx:#231E1A;--mu:#746A63;--wn:#935F06;--ds:#D31212}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.5 "IBM Plex Sans Thai",Inter,system-ui,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:16px}header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0}
.brand{font-weight:800;color:var(--p);letter-spacing:.02em}.badge{font-size:13px;padding:4px 10px;border-radius:999px;border:1px solid var(--bd);background:var(--card)}
.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:16px;margin:12px 0}
pre{white-space:pre-wrap;word-break:break-word;font:inherit;margin:0}h2{font-size:15px;margin:0 0 8px;color:var(--mu);font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.thumb{display:block;border:1px solid var(--bd);border-radius:10px;overflow:hidden;background:#fff;color:inherit;text-decoration:none}
.thumb img{display:block;width:100%;aspect-ratio:1;object-fit:cover}.thumb .cap{font-size:12px;padding:6px 8px;color:var(--mu);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pdf{display:flex;align-items:center;justify-content:center;aspect-ratio:1;font-weight:700;color:var(--ds)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 16px;border-radius:12px;border:1px solid var(--bd);background:var(--card);color:var(--tx);font-weight:600;text-decoration:none;cursor:pointer;font-size:15px}
.btn.primary{background:var(--p);color:#fff;border-color:var(--p)}.btn.danger{color:var(--ds);border-color:var(--ds)}.btn.warn{color:var(--wn);border-color:var(--wn)}
.btn.selected{outline:3px solid rgba(11,122,85,.35)}
.btn:disabled{opacity:.5;cursor:default}.actions{display:grid;gap:10px;grid-template-columns:1fr}@media(min-width:480px){.actions{grid-template-columns:1fr 1fr 1fr}}
.actions.actions-2col{grid-template-columns:1fr 1fr}.actions.actions-1col{grid-template-columns:1fr}
.note{font-size:13px;color:var(--mu)}.note.reply-intro{margin:0 0 8px}.note.m0{margin:0}
.field-label{display:block;margin-top:10px}.field-label-tight{display:block;margin-top:8px}
#name{width:100%;min-height:44px;border:1px solid var(--bd);border-radius:10px;padding:0 10px;font:inherit}
#reply-submit{width:100%;margin-top:10px}#copy-text{margin-top:10px}
#reply-status{color:var(--p)}#reply-status.bad{color:var(--ds)}
.banner{padding:12px 14px;border-radius:12px;background:#E6F4EE;color:var(--p);font-weight:700}.banner.bad{background:#FCE8E8;color:var(--ds)}.banner.warn{background:#FBF1DC;color:var(--wn)}
textarea{width:100%;min-height:72px;border:1px solid var(--bd);border-radius:10px;padding:10px;font:inherit}footer{padding:24px 0;font-size:13px;color:var(--mu)}
.sr{position:absolute;left:-9999px}
body.lb-open{overflow:hidden}
.lb{position:fixed;inset:0;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;z-index:50}.lb[hidden]{display:none}.lb img{max-width:96vw;max-height:84vh;object-fit:contain}
.lb button{position:absolute;min-width:44px;min-height:44px;border:0;background:rgba(255,255,255,.15);color:#fff;font-size:22px;border-radius:12px;cursor:pointer}.lb-close{top:12px;right:12px}.lb-prev{left:8px;top:50%;transform:translateY(-50%)}.lb-next{right:8px;top:50%;transform:translateY(-50%)}.lb-cap{position:absolute;bottom:14px;left:0;right:0;text-align:center;color:#fff;font-size:13px}
`;

function fileTile(file: SharePageFile): string {
  const name = escapeHtml(file.originalName ?? 'ไฟล์');
  const isImage = file.mimeType.startsWith('image/');
  const body = isImage
    ? `<img src="${escapeHtml(file.url)}" alt="${name}" loading="lazy">`
    : `<div class="pdf" aria-hidden="true">PDF</div>`;
  // รูป → เปิด lightbox (data-lb) · PDF → เปิดแท็บใหม่
  return `<a class="thumb" href="${escapeHtml(file.url)}" ${isImage ? 'data-lb="1"' : 'target="_blank" rel="noopener"'}>${body}<div class="cap">${name} · ${fmtBytes(file.size)}</div></a>`;
}

export function buildFinanceSharePage(input: SharePageInput): string {
  const open = OPEN_FOR_REPLY.includes(input.status);
  // PARTNER_ACK อนุญาตเฉพาะจากสถานะ SENT (finance-application-status.util.ts) — โชว์ปุ่ม
  // "รับเรื่องแล้ว" ตอน MORE_INFO/ACKNOWLEDGED จะกด 409 ทุกครั้ง (fix round 1 Minor 7)
  const canAck = input.status === 'SENT';
  const groups = input.groups.filter((g) => g.files.length > 0)
    .map((g) => `<section class="card"><h2>${escapeHtml(g.label)} (${g.files.length})</h2><div class="grid">${g.files.map(fileTile).join('')}</div></section>`)
    .join('');
  const result = RESULT_LABEL[input.status];
  const banner = result
    ? `<div class="banner ${input.status === 'APPROVED' ? '' : input.status === 'CANCELLED' ? 'warn' : 'bad'}">ผลล่าสุด: ${escapeHtml(result)}</div>`
    : input.status === 'MORE_INFO' ? `<div class="banner warn">แจ้งขอเอกสารเพิ่มแล้ว — ร้านจะส่งเพิ่มในลิงก์นี้</div>` : '';
  const replyBlock = open ? `
<section class="card" id="reply">
  <h2>ตอบกลับร้าน</h2>
  <p class="note reply-intro">กดปุ่มเดียว ร้านเห็นทันทีในระบบ · หรือจะตอบในกลุ่มไลน์ตามเดิมก็ได้ · <strong>ไม่ใช่การอนุมัติทางการ</strong> — สัญญาเกิดเมื่อร้านกรอกฟอร์มในระบบ GFIN</p>
  <div class="actions actions-2col" role="radiogroup" aria-label="คำตอบ">
    ${canAck ? '<button class="btn" type="button" role="radio" aria-checked="false" data-reply="ACK">รับเรื่องแล้ว</button>' : ''}
    <button class="btn warn" type="button" role="radio" aria-checked="false" data-reply="MORE_INFO">ขอเอกสารเพิ่ม</button>
    <button class="btn primary" type="button" role="radio" aria-checked="false" data-reply="APPROVED">อนุมัติ</button>
    <button class="btn danger" type="button" role="radio" aria-checked="false" data-reply="REJECTED">ไม่อนุมัติ</button>
  </div>
  <label class="note field-label" for="note">ข้อความถึงร้าน (ถ้ามี)</label>
  <textarea id="note" maxlength="500" placeholder="เช่น ขอสลิปเงินเดือนเดือนล่าสุด"></textarea>
  <label class="note field-label-tight" for="name">ชื่อผู้ตอบ</label>
  <input id="name" maxlength="80" placeholder="เช่น คุณเอ">
  <button class="btn primary" type="button" id="reply-submit" disabled>ส่งคำตอบ</button>
  <p class="note" id="reply-status" role="status" aria-live="polite"></p>
</section>` : '';
  const script = `
(function(){var lb=document.getElementById('lightbox');var img=lb.querySelector('img');var cap=lb.querySelector('.lb-cap');var items=Array.prototype.slice.call(document.querySelectorAll('a[data-lb]'));var i=-1;
function show(n){if(n<0||n>=items.length)return;i=n;img.src=items[n].getAttribute('href');cap.textContent=(n+1)+' / '+items.length+' · '+items[n].querySelector('.cap').textContent;lb.hidden=false;document.body.classList.add('lb-open')}
function hide(){lb.hidden=true;img.src='';document.body.classList.remove('lb-open')}
items.forEach(function(a,n){a.addEventListener('click',function(e){e.preventDefault();show(n)})});
lb.querySelector('.lb-prev').addEventListener('click',function(){show(i-1)});lb.querySelector('.lb-next').addEventListener('click',function(){show(i+1)});lb.querySelector('.lb-close').addEventListener('click',hide);
document.addEventListener('keydown',function(e){if(lb.hidden)return;if(e.key==='Escape')hide();if(e.key==='ArrowLeft')show(i-1);if(e.key==='ArrowRight')show(i+1)});
var sx=0;lb.addEventListener('touchstart',function(e){sx=e.touches[0].clientX},{passive:true});lb.addEventListener('touchend',function(e){var dx=e.changedTouches[0].clientX-sx;if(dx>40)show(i-1);if(dx<-40)show(i+1)});
var copy=document.getElementById('copy-text');if(copy){copy.addEventListener('click',function(){var t=document.getElementById('message-text').textContent;navigator.clipboard.writeText(t).then(function(){copy.textContent='คัดลอกแล้ว'})})}
var b=document.querySelectorAll('[data-reply]');var s=document.getElementById('reply-status');var submit=document.getElementById('reply-submit');var name=document.getElementById('name');var busy=false;var chosen=null;
function set(t,bad){if(s){s.textContent=t;s.classList.toggle('bad',!!bad)}}
function ready(){if(submit)submit.disabled=!(chosen&&name&&name.value.trim())}
b.forEach(function(el){el.addEventListener('click',function(){chosen=el.getAttribute('data-reply');b.forEach(function(x){x.setAttribute('aria-checked',x===el?'true':'false');x.classList.toggle('selected',x===el)});ready()})});
if(name)name.addEventListener('input',ready);
if(submit)submit.addEventListener('click',function(){if(busy||!chosen)return;var n=(document.getElementById('note')||{}).value||'';busy=true;submit.disabled=true;
fetch(${escapeJsonForScript(input.replyUrl)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:chosen,name:name.value.trim(),note:n})})
.then(function(res){return res.json().then(function(j){return{ok:res.ok,j:j}})})
.then(function(x){if(x.ok){set('บันทึกแล้ว ร้านได้รับแจ้งทันที');setTimeout(function(){location.reload()},800)}else{set((x.j&&x.j.message)||'บันทึกไม่สำเร็จ ลองใหม่',true);busy=false;ready()}})
.catch(function(){set('เครือข่ายขัดข้อง ลองใหม่',true);busy=false;ready()})})})();`;
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<meta property="og:title" content="BESTCHOICE — ชุดเช็คเครดิต"><meta property="og:description" content="เอกสารเช็คเครดิตจากร้าน BESTCHOICE (ลิงก์มีวันหมดอายุ)"><meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700&display=swap">
<title>ชุดเช็คเครดิต ${escapeHtml(input.number)} — BESTCHOICE</title><style nonce="${input.nonce}">${CSS}</style></head>
<body><div class="wrap">
<header><div class="brand">BESTCHOICE</div><div class="badge">ใบยื่น ${escapeHtml(input.number)} · ลิงก์ถึง ${escapeHtml(fmtThaiDate(input.expiresAt))}</div></header>
${banner}
<section class="card"><h2>ข้อมูลลูกค้า (12 ข้อ)</h2><pre id="message-text">${escapeHtml(input.messageText)}</pre><button class="btn" type="button" id="copy-text">คัดลอกข้อมูล</button></section>
<div class="actions actions-1col"><a class="btn" href="${escapeHtml(input.zipUrl)}">ดาวน์โหลดทั้งหมด (${input.fileCount} ไฟล์)</a></div>
${groups}
${replyBlock}
<div id="lightbox" class="lb" hidden role="dialog" aria-label="ดูรูปเต็มจอ"><button type="button" class="lb-close" aria-label="ปิด">✕</button><button type="button" class="lb-prev" aria-label="รูปก่อนหน้า">‹</button><img alt=""><button type="button" class="lb-next" aria-label="รูปถัดไป">›</button><div class="lb-cap"></div></div>
<footer>ติดต่อร้านผ่านกลุ่มไลน์ <strong>${escapeHtml(input.lineGroupName)}</strong> · หน้านี้ไม่มีข้อมูลบัตรในรูปแบบข้อความนอกจากที่ร้านพิมพ์ · ไฟล์ถูกลบอัตโนมัติ 90 วันหลังปิดใบยื่น</footer>
</div><script nonce="${input.nonce}">${script}</script></body></html>`;
}

export function buildGonePage(nonce: string): string {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>ลิงก์หมดอายุ — BESTCHOICE</title><style nonce="${nonce}">${CSS}</style></head>
<body><div class="wrap"><header><div class="brand">BESTCHOICE</div></header>
<section class="card"><h2>ลิงก์นี้หมดอายุหรือถูกยกเลิกแล้ว</h2><p class="note m0">ขอลิงก์ใหม่จากร้านได้ในกลุ่มไลน์ <strong>${escapeHtml(LINE_GROUP_NAME)}</strong></p></section>
</div></body></html>`;
}
