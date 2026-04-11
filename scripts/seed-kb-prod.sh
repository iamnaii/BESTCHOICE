#!/bin/bash
# Seed chatbot-finance KB entries on production via Cloud Run Job
set -e

PROJECT="bestchoice-prod"
REGION="asia-southeast1"
JOB="bestchoice-seed"

# Write seed script to temp file, then base64 encode for transport
SEED_SCRIPT='
const{PrismaClient}=require("@prisma/client");
const p=new PrismaClient();
const E=[
{intent:"product_iphone",category:"product",triggerKeywords:["iPhone","ไอโฟน","มือถือ","รุ่นไหน","ราคา","สนใจ"],exampleQuestions:["มี iPhone รุ่นไหนบ้าง"],responseTemplate:"เรามี iPhone หลายรุ่นทั้งมือ1 และมือ2 ค่ะ\n✅ บัตรประชาชน\n✅ ไม่เช็คเครดิตบูโร\n✅ อนุมัติ 15 นาที",responseType:"auto",requiresAuth:false,priority:70},
{intent:"product_ipad",category:"product",triggerKeywords:["iPad","ไอแพด","แท็บเล็ต"],exampleQuestions:["มี iPad ไหม"],responseTemplate:"เรามี iPad มือ1 (ใหม่จาก Apple) ค่ะ\n✅ บัตรประชาชนใบเดียว\n✅ ไม่เช็คเครดิตบูโร\n✅ อนุมัติ 15 นาที",responseType:"auto",requiresAuth:false,priority:65},
{intent:"android_redirect",category:"product",triggerKeywords:["Samsung","ซัมซุง","OPPO","Vivo","Xiaomi","Android","แอนดรอยด์"],exampleQuestions:["มี Samsung ไหม"],responseTemplate:"BESTCHOICE เชี่ยวชาญด้าน iPhone และ iPad โดยเฉพาะค่ะ ขณะนี้ยังไม่มีบริการสำหรับ Android สนใจดู iPhone ไหมคะ?",responseType:"auto",requiresAuth:false,priority:85},
{intent:"ipad_used_redirect",category:"product",triggerKeywords:["iPad มือสอง","iPad มือ2","ไอแพดมือสอง"],exampleQuestions:["มี iPad มือ2 ไหม"],responseTemplate:"ขณะนี้เรามีเฉพาะ iPad มือ1 (ใหม่จาก Apple) ค่ะ ยังไม่มี iPad มือ2 ในสต็อก",responseType:"auto",requiresAuth:false,priority:65},
{intent:"installment_documents",category:"onboarding",triggerKeywords:["เอกสาร","ใช้อะไรบ้าง","ผ่อนยังไง","เงื่อนไข","ขั้นตอน","สมัคร"],exampleQuestions:["ผ่อนต้องใช้เอกสารอะไร"],responseTemplate:"เอกสาร: บัตร ปชช + ทะเบียนบ้าน + Slip เงินเดือน 3 เดือน\nขั้นตอน: ส่งเอกสาร > รอ 15 นาที > เซ็นสัญญา รับเครื่อง\nไม่เช็คเครดิตบูโรค่ะ",responseType:"auto",requiresAuth:false,priority:80},
{intent:"complaint",category:"escalation",triggerKeywords:["ร้องเรียน","ไม่พอใจ","complaint","ผิดหวัง"],exampleQuestions:["ขอร้องเรียน"],responseTemplate:"ขอโทษที่ทำให้ไม่สะดวกนะคะ กำลังส่งเรื่องให้ผู้จัดการดูแลโดยตรง ติดต่อกลับภายใน 24 ชม 063-134-6356",responseType:"handoff",requiresAuth:false,priority:95},
{intent:"payment_method",category:"payment",triggerKeywords:["จ่ายยังไง","ชำระยังไง","โอนเงิน","ชำระเงิน","วิธีจ่าย","บัญชี"],exampleQuestions:["จ่ายค่างวดยังไง"],responseTemplate:"ชำระค่างวดได้ 2 วิธีค่ะ\n\n💳 วิธีที่ 1: สแกน QR (แนะนำ)\nพิมพ์ \"ชำระ\" แล้วน้องเบสจะสร้าง QR ให้ค่ะ\n\n🏦 วิธีที่ 2: โอนเงิน\nธ.กสิกรไทย 203-1-16520-5\nชื่อ บจก. เบสท์ช้อยส์โฟน\nแล้วส่งสลิปมาในแชทนี้ได้เลยค่ะ",responseType:"auto",requiresAuth:false,priority:75},
{intent:"late_fee_explain",category:"payment",triggerKeywords:["ค่าปรับ","ปรับ","ล่าช้า","ทำไมโดนปรับ","ค่าปรับกี่บาท"],exampleQuestions:["ค่าปรับคิดยังไง"],responseTemplate:"ค่าปรับล่าช้า 50 บาท/วัน นับจากวันที่เลยกำหนดค่ะ\n\n💡 ชำระตรงเวลา ไม่มีค่าปรับ + ได้แต้มสะสมด้วยนะคะ\n\nพิมพ์ \"เช็คยอด\" เพื่อดูยอดค้างชำระปัจจุบันค่ะ",responseType:"auto",requiresAuth:false,priority:70},
{intent:"early_payoff_info",category:"payment",triggerKeywords:["ปิดยอด","ปิดก่อน","จ่ายหมด","ปิดสัญญา","ปิดค่างวด"],exampleQuestions:["อยากปิดยอดก่อนกำหนด"],responseTemplate:"สนใจปิดยอดก่อนกำหนดใช่ไหมคะ? ดีเลยค่ะ ปิดก่อนได้ส่วนลดดอกเบี้ย 50%!\n\nรบกวนแจ้งเจ้าหน้าที่เพื่อคำนวณยอดปิดให้นะคะ",responseType:"handoff",requiresAuth:true,priority:70}
];
async function main(){let c=0,u=0;for(const e of E){const x=await p.chatKnowledgeBase.findFirst({where:{channel:"LINE_FINANCE",intent:e.intent}});if(x){await p.chatKnowledgeBase.update({where:{id:x.id},data:{category:e.category,triggerKeywords:e.triggerKeywords,exampleQuestions:e.exampleQuestions,responseTemplate:e.responseTemplate,responseType:e.responseType,requiresAuth:e.requiresAuth,priority:e.priority,active:true}});u++}else{await p.chatKnowledgeBase.create({data:{channel:"LINE_FINANCE",...e}});c++}}console.log("Done. Created:"+c+" Updated:"+u)}
main().catch(e=>{console.error(e);process.exit(1)}).finally(()=>p.$disconnect());
'

B64=$(echo "$SEED_SCRIPT" | base64 -w0)

echo "Updating Cloud Run job..."
gcloud run jobs update "$JOB" \
  --project="$PROJECT" \
  --region="$REGION" \
  --command="sh" \
  --args="-c,echo $B64 | base64 -d > /tmp/s.js && node /tmp/s.js"

echo "Executing..."
gcloud run jobs execute "$JOB" \
  --project="$PROJECT" \
  --region="$REGION" \
  --wait

echo "Done!"
