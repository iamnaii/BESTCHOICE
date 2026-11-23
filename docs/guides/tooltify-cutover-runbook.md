# คู่มือตัดระบบ Tooltify สำหรับร้าน SHOP

**สถานะ ณ 22 พฤศจิกายน 2026 — รอหลักฐานก่อนกำหนดวันย้ายจริง** โปรแกรมผ่านการซ้อมด้วย XLSX สังเคราะห์บน PostgreSQL แยกต่างหาก เจ้าของร้านยังต้องรับรองยอดจริง สาขา ราคาพร้อมขาย งานค้าง และผลกู้คืน backup จริงก่อนอนุมัติให้เขียนข้อมูล สรุปผลซ้อมและเวลาที่วัดได้อยู่ท้ายคู่มือนี้

## ใบควบคุมรอบจริง

ทำสำเนาตารางนี้ในพื้นที่จำกัดสิทธิ์ต่อรอบ เวลาใช้ Asia/Bangkok พร้อมวันและ offset +07:00 ผู้ถือหลักฐานลงชื่อและเวลาจริง ณ ขั้นที่ทำเสร็จ

| รายการ | ผู้บันทึก / หลักฐานที่ต้องแนบ | ค่ารอบจริง |
| --- | --- | --- |
| ผู้ตัดสินหยุด/เปิดและอนุมัติการเขียน | เจ้าของร้าน ชื่อและช่องทางติดต่อ | รอระบุ |
| ผู้ปฏิบัติการนำเข้าและผู้ดูแลฐานที่เปิด/ปิด admission ได้ | ระบุชื่อ สิทธิ์ maintenance DB และผู้รับช่วง | รอระบุ |
| ผู้ตรวจคลังและผู้ตรวจบัญชี | ระบุชื่อแยกบทบาทและสาขาที่ครอบคลุม | รอระบุ |
| T เวลาหยุด Tooltify / G เวลาเปิด BESTCHOICE | เจ้าของร้าน บันทึกเวลาวางแผนและเวลาจริง T ≤ G | รอกำหนดทั้งคู่ |
| เวลาหยุดสูงสุด / เส้นตายตัดสิน rollback | เวลาซ้อมขนาดเท่าของจริง รวม export ตรวจมือ ปิดช่องทาง ระบายคิว rollback และเปิดคืน เผื่อเวลาย้อนคืนก่อนถึงเวลาหยุดสูงสุด | รอวัดและลงนาม |
| สำรอง production | ผู้ดูแลฐาน ระบุ instance, DB, backup ID, เวลา/จุดกู้คืน, สถานะเสร็จสมบูรณ์ และที่เก็บหลักฐาน | รอ backup จริง |
| ทดสอบกู้คืน production backup | ชื่อฐาน/instance ทดสอบแยก, backup ID เดียวกัน, เวลาเริ่ม–เสร็จ, schema/migrations, counts/ยอดควบคุมและผู้ตรวจ | รอผลกู้จริง |
| ข้อมูลและโปรแกรม | manifestHash, decisionsHash, SHA-256 ของทุกไฟล์, canonicalSetId, codeRevision จาก checkout สะอาด, migration ล่าสุด | รอชุดสุดท้าย |
| เป้าหมาย | ผู้ดูแลยืนยัน endpoint/instance, database, schema, DB fingerprint เทียบกับทะเบียนระบบที่อนุมัติ | รอตรวจ |
| การอนุมัติรอบ | แยก STOCK และ SALES ระบุ planHash, batch ID จาก receipt, ผู้อนุมัติ, เวลาจริง, ที่เก็บรายงาน | รอตรวจและอนุมัติ |
| งานค้าง / เปิดขาย | ผู้รับช่วงแต่ละทะเบียน ลายเซ็นคลัง บัญชี เจ้าของ และเวลาที่ G | รอส่งมอบ |

### เกณฑ์ก่อนนัด T

1. ผู้ตรวจคลังจับคู่หลักฐาน export กับร้านต้นทางและ branch ID ของ SHOP ทุกไฟล์ เลือก snapshot เดียวต่อสาขาที่ T ห้ามคำนวณคงเหลือจากประวัติขาย ตรวจ IMEI เป็นข้อความ เทียบตัวเครื่องจริง สำรวจสถานะจอง/ชำรุด/พักตรวจ หมายถึงอะไรในต้นทาง นับ Accessories ตาม SKU และตรวจว่าหนึ่งแถวกี่หน่วย แยกคูปองหรือบริการพร้อมหลักฐาน ทดสอบ CREATE/MATCH กับสต๊อกเดิมรวมเครื่องขายแล้ว/soft-delete/มีสัญญา/hold ก่อนอนุญาตเปิดขาย
2. ผู้ตรวจบัญชียืนยันหน่วยของคอลัมน์สรุปต้นทุนด้วยคู่มือหรือตัวอย่างเอกสารที่ตรวจจำนวนและต้นทุนต่อหน่วยได้ ตรวจราคาปัจจุบันและแหล่งที่มาทุกรายการทั้งราคาสินค้าและ ProductPrice ค่า 0 หรือราคาขายในอดีตใช้แทนข้อมูลที่ขาดไม่ได้ ต้องผ่าน hasSellingPrice สำหรับสถานะพร้อมขาย
3. ประวัติขายต้องครอบคลุมช่วงเริ่มต้นที่อนุมัติจน T ทุกสาขา พร้อมหลักฐานวันที่ยอดศูนย์ ตัวกรองไฟล์ทับช่วง บิลหลายรายการ และการคืน/ยกเลิกที่ผูกบิลเดิม ให้คงการขาย IMEI เดิมต่างบิลไว้ทุกเหตุการณ์ ตรวจคู่ Accessories ที่ซ้ำภายในบิลตามจำนวนในบิลจริง และแก้ข้อยกเว้นหมวด/บาร์โค้ดตามเลขแถวพร้อมหลักฐาน
4. ยอดขายไฟล์ล่าสุด 460 บิล 1,380 แถวมีราคาขายในสรุปต่ำกว่ารายละเอียด **152,290.00 บาท** ส่วนต่างอยู่ในกลุ่มโอน ต้องให้ผู้ตรวจบัญชีตรวจความหมายรายงานและส่งหลักฐานหรือ export ที่พิสูจน์ยอดก่อนรับรองชุดจริง ต้นทุนสรุปสต๊อก 73 กลุ่มยังรอหลักฐานต่อหน่วย/รวม [ทะเบียนหลักฐานต้นทางและช่วงที่ขาด](../superpowers/plans/2026-11-21-tooltify-source-decisions.md)
5. สำรวจสัญญาค้าง เงินจอง เครดิตลูกค้า ซ่อม/เคลม และประกัน แยกรายการเปิด ยอด เอกสารที่ตามได้ ผู้รับช่วง และกำหนดส่งมอบ ตรวจยอดส่งออกกับผู้รับ แม้พบศูนย์ให้บันทึกแหล่งตรวจและผู้รับรอง ก่อน G ต้องมีวิธีปฏิบัติงานต่อทุกกรณี
6. ผู้ดูแลสำรองฐานและทดสอบกู้คืนไปยัง instance แยก ตรวจสิทธิ์เข้าถึง archive, schema, index, migration และยอดควบคุมสต๊อก ประวัติ บัญชี ธุรกรรมที่มีอยู่และรายการตัวอย่าง บันทึกผลในใบควบคุม ก่อน apply ยืนยันจุดกู้คืนครอบคลุมธุรกรรมสุดท้ายที่เกี่ยวข้องและมีเส้นทางกู้คืนที่ทดสอบแล้ว ทดสอบสิทธิ์ freeze/lock กับสภาพแวดล้อมเทียบเท่า หาก provider ไม่ให้สิทธิ์ ให้หยุดและตกลงวิธีกู้คืนก่อน T [คู่มือ backup ของระบบ](BACKUP-RUNBOOK.md)
7. ซ้อมด้วยปริมาณและโครงสร้างที่จะใช้จริงบนฐานแยก วัดเวลาแต่ละขั้นและให้เจ้าของอนุมัติหน้าต่างหยุด ตรวจทุก gate รวมราคาตรงรุ่น/สาขาและข้อมูลค้าง ใช้ข้อมูลอ่อนไหวเฉพาะพื้นที่ภายในที่ได้รับสิทธิ์ เก็บ workbook, decisions, รายงานและข้อมูล login นอก Git จำกัดสิทธิ์ directory 0700 และไฟล์ 0600

## ที่ T จนถึง G

**1. ปิดรับรายการและทำทะเบียนข้อยกเว้น** เจ้าของแจ้งเวลา T จริง หยุดการขาย คืน รับเข้า โอน ปรับสต๊อก จอง ผ่านเคาน์เตอร์ เว็บ ออเดอร์ออนไลน์ งานเบื้องหลัง และ integrations ที่เปลี่ยนยอดของทั้งสองระบบ ตรวจว่างานที่รับก่อน T จบหรือมีทะเบียนติดตาม รายการจำเป็นช่วงหยุดให้ใช้เลขทะเบียนไม่ซ้ำ เก็บเวลา ผู้รับผิดชอบ สาขา IMEI/SKU หน่วย เงิน และเอกสารอ้างอิง เก็บเลขรายการปลายทางเมื่อลงหลัง G

**2. ส่งออกหลังธุรกรรมสุดท้าย** ทำบัญชีไฟล์ต้นฉบับอย่างอ่านอย่างเดียว ตรวจ SHA-256 ของทุกพาธรวมสำเนา ช่วงวันที่ไทยจริง ร้าน/สาขา สรุปและตารางรายละเอียด สร้าง manifest และ source-decisions ผูก checksum กับแถวและ evidenceRef เก็บไฟล์สองชุดนี้ในพื้นที่ส่วนตัว หากพบรายการหลัง snapshot หรือไฟล์เปลี่ยน ให้ทำชุดและตรวจสอบใหม่

**3. ตรวจไฟล์และทำ dry-run ทั้งสองชนิดบนเป้าหมายจริง** ใช้ checkout ที่ติดตามโดย Git และสะอาด ทุกคำสั่งรันจาก root ของ checkout ใน shell ที่ระบุเป้าหมายเอง ตรวจ database identity ด้วยผู้ดูแลจากทะเบียนระบบและค่าฝั่งเซิร์ฟเวอร์ (host/port/database/schema) เก็บ fingerprint ที่คาดไว้และเทียบกับรายงาน อ่าน manifest JSON เดียวกันตลอดรอบ npm รัน CLI จาก apps/api ให้ใช้พาธสัมบูรณ์ตั้งแต่ต้นจนจบรอบ โดย `M` คือไฟล์ manifest ที่ตรวจแล้ว `R` คือไดเรกทอรีรายงานใหม่ และ `DIR` คือ `$R/stock` หรือ `$R/sales` ระบุพาธ workbook ใน manifest ให้ตรงกับพาธสัมบูรณ์ที่ตรวจไฟล์ คง source-decisions.json ไว้ข้าง manifest หากใช้ไฟล์ decisions ที่อื่น ให้ส่ง `--decisions "$DECISIONS"` โดยใช้พาธสัมบูรณ์เดียวกันทั้ง dry-run และ apply

~~~sh
umask 077
mkdir -m 700 "$R"
mkdir -m 700 "$R/inspect" "$R/stock" "$R/sales"
cutover() { npm --silent run import:tooltify-cutover --workspace=@installment/api -- "$@"; }
cutover inspect --manifest "$M" --out-dir "$R/inspect"
cutover dry-run --manifest "$M" --source-kind current-stock-snapshot --out-dir "$R/stock"
cutover dry-run --manifest "$M" --source-kind sales --out-dir "$R/sales"
~~~

ก่อนอนุมัติเขียน ให้ผู้ตรวจอ่าน inspection.json/.csv และ dry-run.json ทั้งสองชนิด เทียบยอดสรุปกับรายละเอียด และยอดดิบหลังหักรายการปรับที่มีหลักฐานกับยอด canonical ส่วนต่างที่อธิบายไม่ได้ต้องเป็นศูนย์ ตรวจจำนวนและเหตุผลรายแถวของแผน CREATE/MATCH/EXCLUDE พร้อมตรวจ targetId ของ MATCH กับสินค้าเดิมหรือประวัติเดิมที่อ้างถึง สำหรับ CREATE ให้ตรวจข้อมูลที่จะสร้าง ตรวจสาขา/SKU/สถานะ/ทุน/ราคา และเดือน/ช่องทาง/จำนวนบิล/แถว/เงินถึงสตางค์ เทียบ hash กับใบควบคุม หากมี issue หรือ CONFLICT, sourceVerified ไม่จริง, ยอดระบุไม่ได้ หรือ exit code ไม่เป็นศูนย์ ให้หยุด

**4. ขออนุมัติแล้วจึง apply** เจ้าของอนุมัติ planHash ของแต่ละชนิดพร้อม manifestHash, revision และ fingerprint ที่ตรวจแล้วเท่านั้น ให้ operator ใช้ DATABASE_URL จากระบบ secret ของเป้าหมาย ตั้ง EXPECTED_DB_NAME, EXPECTED_DB_FINGERPRINT ตามใบควบคุม สำหรับคำสั่งเขียนแต่ละคำสั่งต้องส่ง CONFIRM_TOOLTIFY_IMPORT=YES_I_AM_SURE และสำหรับเป้าหมายจริงต้องส่ง ALLOW_PROD_TOOLTIFY_IMPORT=YES_I_AM_SURE เฉพาะ invocation ที่อนุมัติ ห้ามเก็บรหัส/URL ฐานในรายงานหรือคง flags เขียนไว้ใน shell ส่วนกลาง

รอให้การ checkout/setup/commit เสร็จและขึ้นวินาทีใหม่ก่อนเริ่ม Node process สำหรับ apply แต่ละครั้ง คง worktree และโฟลเดอร์ Git ที่ตำแหน่ง canonical เดิม ควบคุม parent และ mount ให้ tracked files, โฟลเดอร์บรรพบุรุษ และ effective Git metadata คงที่จนจบ หากพบ CUTOVER_FRESH_PROCESS_REQUIRED ให้ตรวจ revision กับแผนที่อนุมัติแล้วเริ่ม process ใหม่

รูปแบบอาร์กิวเมนต์หลัง cutover คือ `apply --manifest "$M" --source-kind "$KIND" --out-dir "$DIR" --apply --plan-hash "$REVIEWED_IMPORT_HASH"` ใช้ current-stock-snapshot กับ R/stock และ sales กับ R/sales ทีละรอบ อ่าน apply-receipt.json เพื่อจด batchId จำนวนและสถานะ ใช้ batchId ค้น TooltifyImportItem เพื่อดู targetId รายแถวของ CREATE/MATCH แล้วตรวจ verification.json ต้องได้ VERIFIED และ canOpen=true ทั้งคู่ หากหยุดกลางทาง ตรวจสถานะ batch และ committed receipts ก่อน retry ด้วย input/plan เดิม เมื่อ hash หรือ dependency เปลี่ยน ให้หยุดทบทวนก่อนอนุมัติอีกครั้ง

**5. ตรวจรับบนฐานที่นำเข้า** ใช้ batch ID ของแต่ละ receipt กับ `cutover reconcile --manifest "$M" --source-kind "$KIND" --batch-id "$BATCH" --out-dir "$DIR"` เก็บ reconciliation.json แยก STOCK/SALES ก่อนเปิดที่ G ผู้ตรวจต้องพบ VERIFIED และ canOpen=true ทั้งสอง batch เทียบ canonical.totals กับ target.totals ที่อ่านจากฐานหลัง apply และตรวจ deltas.canonicalToTarget ทั้งแถวรวมและทุกกลุ่มให้เป็นศูนย์ทุกช่อง ทั้งหน่วยและต้นทุนตามสาขาและชนิด DEVICE/ACCESSORY กลุ่ม ACCESSORY แยกเพิ่มตาม skuHash ส่วน DEVICE ตรวจเทียบเครื่องจริงทีละ targetId และจำนวนบิล รายการ ต้นทุน ราคาตั้ง ราคาขาย กำไรตามสาขา/เดือน/ช่องทาง เทียบจำนวนที่สร้าง/ตรงเดิม/ยกเว้นกับแผนและตรวจปลายทางจริงของแถว CREATE/MATCH จาก targetId ใน TooltifyImportItem ของ batchId นั้น ตรวจ sideEffects แยกอีกครั้ง ทั้ง sales, contracts, payments, commissions, externalCommissions, receipts และ journalEntries ต้องเป็นศูนย์ทุกช่อง หากข้อใดไม่ผ่านให้คงการหยุดรับรายการ ดูรหัสอ้างอิงบิล/IMEI ตัวอย่างแบบ read-only ใน SHOP รวม IMEI เดิมมากกว่าหนึ่งบิลและบิลหลายแถว เปิดหน้า Stock/POS ตรวจสาขา สถานะ ต้นทุน ราคาและสิทธิ์ของสินค้าที่จะขาย ตรวจหน้าประวัติด้วยบทบาทจริง ผู้ไม่มีสิทธิ์เห็นต้นทุน/กำไรต้องได้ค่าปกปิด เก็บผลทดสอบขายจริงในฐานซ้อม

**6. ผู้ตรวจบัญชีเซ็นตารางทุนเปิด** เทียบต้นทุนสินค้าคงเหลือตามสาขากับบัญชีที่ใช้อยู่ ใช้กลไกยอดเปิดที่บัญชีอนุมัติเฉพาะส่วนที่ต้องรับรู้ ห้ามสร้างซื้อหรือจ่ายย้อนหลังจาก snapshot ให้ A = B + C และส่วนต่างที่อธิบายไม่ได้เป็น 0.00 เก็บใบงานแยกตาม SKU/IMEI อ้างเอกสารเดิม แม้ batch เป็น VERIFIED ช่องที่ยังไม่ตรวจต้องคงเป็นรอตรวจ

| สาขา/กลุ่มและเอกสารนับ | A ทุน canonical ที่ตรวจแล้ว | B ทุนที่เคยรับรู้และเอกสารบัญชี | C ทุนยังไม่รับรู้และวิธียอดเปิด | ส่วนต่าง A−B−C | ผู้ตรวจ/เวลา |
| --- | ---: | ---: | ---: | ---: | --- |
| แต่ละสาขา / รวม SHOP รอบจริง | รอตรวจ | รอตรวจ | รอตรวจ | รอตรวจ | รอลงนาม |

**7. เปิดที่ G และปิดทะเบียนชั่วคราว** เมื่อคลัง บัญชี ผู้รับงานค้าง และเจ้าของตรวจครบทั้งสอง batch จึงบันทึก G จริง เปิดให้ทำรายการใหม่ใน BESTCHOICE อย่างเดียว กระทบยอดรายการระหว่าง T–G และลง BESTCHOICE หนึ่งครั้งต่อเลขทะเบียน บันทึกเลขบิล/รายการปลายทางและให้คนที่สองตรวจจำนวน หน่วย และเงินก่อนปิดทะเบียน เก็บ Tooltify ให้อ่านเพื่อค้นหลักฐาน

## หยุดและย้อนคืน

**ก่อน G** หากขาดหลักฐาน ราคา/สาขา/สถานะ/สิทธิ์ไม่พร้อม ยอดไม่ลงตัว เกินเส้นตาย หรือฐาน/ไฟล์/โปรแกรมเปลี่ยน ให้คงการหยุดรับรายการ แจ้งเจ้าของ ตรวจ batches ที่อาจ commit แล้ว เก็บ artifacts เดิมและทะเบียนชั่วคราว ถ้ามีเพียง dry-run ให้ยุติโดยไม่เขียนฐาน หากต้อง reverse ให้ผู้ดูแลตรวจและอนุมัติทีละ batch โดยจัด batch ที่พึ่งพากันให้ย้อนรายการที่อ้างอิงก่อน ตรวจผู้ใช้จริง/target เปลี่ยนหรือมี reference ทุกครั้ง ถ้ามี blocker ให้ผู้รับผิดชอบกระทบยอดเฉพาะรายการแทนการบังคับย้อน

1. เก็บ original manifest และ directory ส่วนตัวของแต่ละ batch รัน `cutover rollback-dry-run --manifest "$M" --batch-id "$BATCH" --out-dir "$DIR"` ตรวจ rollback-plan.json ทั้ง original import hash, **rollback planHash** ที่ต่างกัน, codeRevision, database, receipt/fingerprint, IDs ที่ batch สร้าง, blockers และจำนวนอ้างอิง เก็บไฟล์เดิมเพื่อใช้ replay
2. หยุดแอป worker และทุกช่องทางเข้า ระบายและตัดการเชื่อมต่อของ clients ที่ผู้รับผิดชอบรู้จัก เคลียร์คำขอค้างใน process/queue ระงับ scheduled jobs และ logical subscriptions ต้องไม่มี prepared transaction ค้าง หากพบ session ไม่ทราบเจ้าของให้หยุดหาผู้รับผิดชอบ วางแผน downtime **ทั้งฐานเป้าหมาย** ทดสอบสิทธิ์ทั้งสองบทบาทระหว่างซ้อม บัญชีของ CLI ที่ใช้ connection เดียวต้องมีสิทธิ์ `pg_read_all_stats` และ `UPDATE` บน `pg_catalog.pg_database` เพื่อให้ CLI เห็น session ทั้งหมดและล็อกแถวฐานเป้าหมายได้ บัญชีนี้ต้องอ่าน ล็อกตารางและแถวที่เกี่ยวข้อง และเขียนข้อมูล rollback ได้ด้วย ผู้ดูแลใช้ connection แยกไป **maintenance database อื่นใน cluster เดียวกัน** ตลอดขั้นตอน บัญชี maintenance ต้องตรวจ session ของฐานเป้าหมายและใช้ `ALTER DATABASE` ปิดและเปิด admission ได้
3. ใช้ checkout และโฟลเดอร์ Git ที่ตำแหน่ง canonical คงที่ ควบคุมการย้าย/แทนที่ parent หรือ mount จบการ checkout/setup/commit แล้วเริ่ม process ใหม่ในวินาทีถัดไปหรือหลังจากนั้น ให้ tracked files, โฟลเดอร์บรรพบุรุษ และ effective Git metadata คงที่จนจบ ถ้ามี ROLLBACK_FRESH_PROCESS_REQUIRED ให้หยุด ตรวจหลักฐาน และเริ่ม process ใหม่ตามเงื่อนไข
4. ผู้ปฏิบัติการเริ่ม `rollback --manifest "$M" --batch-id "$BATCH" --out-dir "$DIR" --apply --plan-hash "$REVIEWED_ROLLBACK_HASH"` โดยใช้ write confirmations และ identity ที่อนุมัติตามขั้น 4 ของการนำเข้า CLI ใช้ connection เดียว รอ AWAITING_DATABASE_FREEZE และจด backendPid ภายในเวลา 60 วินาที ผู้ดูแลตรวจ pg_stat_activity จาก maintenance DB ให้มีเฉพาะ target backend ที่ตรง PID ยืนยันชื่อฐาน จาก session นั้นจึงสั่ง `ALTER DATABASE <verified_target> ALLOW_CONNECTIONS false` โดยใช้ SQL identifier ของฐานที่ตรวจแล้ว CLI ตรวจปิด admission และล็อกแถว pg_database/ตาราง/targets แล้วตรวจหลักฐานซ้ำก่อนเขียน
5. ตรวจ receipt และ durable status คง maintenance gate ปิดจนผู้ดูแลยืนยันผล ความผิดพลาดหลังปิด gate ต้องตรวจขณะ offline หาก commit แล้วแต่ receipt หาย ให้คงแอป/คิวทั้งหมดปิด เปิด admission ชั่วคราวเฉพาะผู้ปฏิบัติการเพื่อ bootstrap pinned CLI ใหม่ถ้าจำเป็น ปิด admission อีกครั้งเมื่อเห็น handshake และ replay **คำสั่งเดิม/แผนเดิม/hash เดิม/batch เดิม/checkout เดิม** ผลซ้ำต้องเปลี่ยน 0 รายการ กรณีขาด durable proof ให้ตรวจด้วยคน
6. รูปแบบ reversal ของ STOCK คือ soft-delete เฉพาะ Product/ราคาใหม่ที่ยังไม่ถูกใช้ ของ MATCH เดิมยังอยู่ ส่วน SALES ลบเฉพาะ ImportedSale ที่ batch สร้าง เก็บ provenance/tombstones จากนั้นผู้ดูแลเปิดจาก maintenance DB ด้วย `ALTER DATABASE <verified_target> ALLOW_CONNECTIONS true` หลังลงนาม จึงเริ่ม process ที่เคลียร์งานค้างแล้ว ตรวจ health และกระทบยอดก่อนอนุญาตกลับเข้าระบบที่เจ้าของเลือก ชุด canonical ที่เป็น ROLLED_BACK ต้องทำรอบ inspect ใหม่ก่อนเสนอ import ใหม่

**หลัง G เมื่อมีธุรกรรมจริง** ระงับเฉพาะสินค้าหรือรายการที่มีปัญหา เก็บ Sale/สัญญา/โอน/บัญชีอ้างอิง แจ้งผู้ดูแลและบัญชี ปรับด้วยเอกสารที่ตรวจสอบได้และกระทบยอดหลังปรับ ห้าม restore backup ทับธุรกรรมจริงหรือย้อน batch อัตโนมัติ การกลับไปใช้ Tooltify ต้องมีแผนเก็บและตรวจธุรกรรมหลัง G ทั้งหมดก่อนเปิดเขียนอีกครั้ง

## หลังเปิด

- **สิ้นวันแรก** เจ้าของสาขาและบัญชีเทียบยอดยกมา รายการช่วง T–G และยอดขาย/รับเงิน/คืน/โอนหลัง G ตรวจเครื่องที่ขายจริงลดจากสต๊อกถูกสาขาและต้นทุนถูกต้อง ตรวจ sample ค้นประวัติและงานค้าง จดข้อผิดปกติ ผู้รับผิดชอบ และผลแก้ไข
- **วันที่ 7** ตรวจซ้ำยอดตามสาขา/ช่องทาง ประวัติและรายการค้าง ปิดทะเบียนชั่วคราวที่เหลือ เก็บรายงานพร้อมผู้ตรวจและเวลาจริง
- **การยกเลิก Tooltify** เจ้าของทดสอบค้นบิล/เอกสารเก่าจาก archive ที่สิทธิ์ใช้งานต่อได้ ตรวจ checksum การเข้าถึง และการส่งต่องานค้างทุกรายการ แล้วจึงอนุมัติยกเลิกแยกต่างหาก วันที่ 7 เป็นวันตรวจ ไม่มีการยกเลิกอัตโนมัติ

## หลักฐานซ้อมในเครื่อง วันที่ 22 พฤศจิกายน 2026

XLSX สังเคราะห์ 2 ไฟล์ ฐาน SHOP 1 สาขา มี Product เดิม 1 รายการ PostgreSQL 16.13, Node v24.14.1, migrations 421 รายการ รวม 20261122000000_tooltify_rollback_proof โปรแกรมใช้คำสั่ง npm ของ checkout สะอาด แต่ละขั้นเริ่ม process ใหม่และตรวจ revision จริง รหัสด้านล่างใช้ค้นหลักฐานรอบซ้อมเท่านั้น

| ตัวระบุ | ค่ารอบซ้อม |
| --- | --- |
| Git revision | 94371c91525b570782d748a3144b360bba4ab447 |
| manifestHash | 6fcd9adce8fda1d847fc06eff0a91606febb0b1181dbe59a4ee5544a85a7252f |
| decisionsHash | d4bd884dc5e2ccba3778588d2707e01c4f21ef21b33f0f80a5d2a2ddf3dd0ed9 |
| DB fingerprint | 4c25c89251a29f53b30750a7a7417f513291ac0c187df6e18f84a4ab9988fc01 |
| STOCK batch / import planHash | c6c5f9e2-c779-4280-a4ad-3f200f5052f4 / 3bc48fb0254e1f2af70572b123ff8de99a19590bab88a629a79928fdb66c5f73 |
| SALES batch / import planHash | efe4403c-7f0a-4ae0-9d3e-666a43410d42 / e73031c78bed830afcf8d00ee81ee136e22d2c3fdb00dfc8ef24d89cd7c6f257 |
| STOCK / SALES rollback planHash | bf0dee559db2a5b10893a5b487c03cd04ee1e5c6d09deb02912832e66c0e665a / 93a42026bff1a2aec6f8b26003187576559fab44ca3172a8b0516ccbe764236e |
| private run / backup ID | run.dpuGtqeD/baseline.dump ขนาด 1,189,346 ไบต์ SHA-256 fdea5a7011b5cc6111322ec04d3226dd85d28ac991b66a1a813646ac4e508c0b |

| รายการ | ต้นทางรายงาน / รายละเอียด | canonical หลังข้อยกเว้น | ปลายทางที่ตรวจจริง |
| --- | --- | --- | --- |
| STOCK | 3 หน่วย 207.00 บาททั้งคู่ | 2 เครื่อง 200.00 บาท ยกเว้นบริการ 1 แถว 7.00 บาทตามหลักฐาน fixture | สร้าง 1 เครื่อง ราคาขายเงินสด 200.00 บาทกับ 1 ProductPrice จับคู่สินค้าเดิม 1 เครื่อง สาขาเดียวกัน ต้นทุนรวม 200.00 บาท |
| SALES พ.ย. 2026 CASH สาขาเดียว | 2 บิล 2 แถว ต้นทุน 10.00 ราคาตั้ง 20.00 ราคาขาย 20.00 กำไร 10.00 บาททั้งคู่ | 2 บิลต่างกันบน IMEI เดียว ยอดทุกช่องตรงรายละเอียด | 2 ImportedSale ยอดทุกช่องตรง canonical ไม่มีผลข้างเคียงทางการเงิน สินค้าบน snapshot ยังพร้อมขาย |
| ย้อนและรันซ้ำ | retry apply ของทั้งคู่คงจำนวนเดิม | SALES ย้อน 2 ประวัติ STOCK พัก 1 เครื่องและราคา 1 แถว | สินค้าเดิมตรงทุกคอลัมน์ หลักฐานทั้ง 2 batches ยังอยู่ replay ของแต่ละ batch เปลี่ยน 0 รายการ |

ทุกยอดต่างหลังหักข้อยกเว้นรวมและรายกลุ่มเป็น 0 การกู้ backup ก่อน apply ลงฐานแยก bc_rehearsal_restore ตรวจเทียบ migrations, จำนวนสินค้า ราคา สาขา template ประวัติขาย Sale และ batch ตรง baseline ทั้งหมด รวมทั้ง digest ของข้อมูล Product เดิมทั้งแถว เทียบ metadata แบบอ่านอย่างเดียวจาก production วันที่ 21 พ.ย. กับฐานซ้อม พบ index definitions ตรง 27/27 รวม active IMEI unique, one default ProductPrice, unique ประวัติขาย และ pricing_templates_market_key ทั้งคู่มี device_origin แบบบังคับ production พบ active PHONE_NEW/UNSPECIFIED 8 และ PHONE_USED/UNSPECIFIED 90 templates มีราคาขายทั้ง 98 รายการ ฐานซ้อมใช้ PHONE_NEW/UNSPECIFIED 1 รายการและราคาที่กำหนดใน fixture การจับคู่ template จริงรายเครื่องและสาขาจริงยังรอยืนยัน

| เวลาที่วัดแบบ wall clock | มิลลิวินาที |
| --- | ---: |
| dump / สร้างฐานกู้ / restore / ตรวจเทียบ | 118 / 33 / 459 / 12 |
| inspect ทั้ง 2 ไฟล์ | 677 |
| STOCK dry-run / apply พร้อม verify / reconcile / retry | 688 / 821 / 607 / 795 |
| SALES dry-run / apply พร้อม verify / reconcile / retry | 683 / 836 / 612 / 797 |
| SALES rollback-dry-run / rollback / replay | 661 / 1,512 / 1,504 |
| STOCK rollback-dry-run / rollback / replay | 662 / 1,522 / 1,529 |

เวลา rollback และ replay รวมการตรวจ PID, ปิด gate และเปิดคืนโดยผู้ปฏิบัติการจำลองจาก maintenance DB ตัวเลขข้างต้นวัดเพียง fixture ขนาดเล็ก เวลาสำหรับ file export จริง ตรวจนับ เซ็นรับ ระบายคิว และ downtime สูงสุดจริงยังรอซ้อมขนาดใช้งาน หลักฐานส่วนตัวอยู่ที่ `.tmp/tooltify-task10/run.dpuGtqeD/`

ชุดทดสอบ PostgreSQL ของ Task 9 ทดสอบขายผ่าน SalesService.create ด้วยเครื่องนำเข้า ราคาเงินสด 200.00 บาท สถานะ SOLD_CASH และเครดิตบัญชีสินค้าคงเหลือ 100.00 บาท งานแจ้งเตือนใช้ตัวจำลอง เครื่องถูกใช้งานแล้วทำให้ rollback ถูกปฏิเสธ การหยุด importer ด้วย SIGKILL หลังแถวแรก commit แล้ว resume ได้สองบิลและ retry ไม่เพิ่มซ้ำ การทดสอบ concurrency พบว่า gate ขวาง writer และการพยายามเปิด admission ระหว่าง transaction ผลของหน้าค้นประวัติและการตรวจ release ใน checkout นี้ดูที่รายงาน Task 8–10 ของรอบส่งมอบ

ทดสอบหน้าประวัติซ้ำโดยเปิด `bash tools/tooltify-sales-preview.sh` จาก checkout นี้ ใช้ origin และ directory ของรอบใหม่จาก preview.json ในคำสั่งเดียวเพื่อทดสอบ Chromium desktop และ Pixel 7 ด้วย API/DB จริง

~~~sh
TOOLTIFY_RUN_DIR="$PREVIEW_DIR" BASE_URL="$PREVIEW_ORIGIN" \
  npm run test:e2e --workspace=@installment/web -- e2e/imported-sales-cutover.spec.ts
~~~

### Supplier preparation and source exceptions (November 2026)

Use `supplier-inspect --workbook FILE --out-dir PRIVATE_DIR` first. It reads the
original workbook SHA256 without a database and preserves text identifiers.
`supplier-plan --input supplier-input.json --context context.json --out-dir PRIVATE_DIR`
requires SHOP company/branch, workbook SHA256, canonical set, cutover timestamp,
and explicit `matchTargets` for existing suppliers. Unknown legal type, name,
phone, VAT or partial bank details block apply. Do not substitute bank holders
for supplier legal names. The owner-adopted Apple Flagship group profile remains
traceable to the Shopee invoice; VAT registration does not create historical VAT entries.

`supplier-apply`, `supplier-verify`, and `supplier-rollback` consume the private
`supplier-plan.json`. Writes require the existing import confirmation, database
fingerprint, reviewed `--plan-hash`, `--apply`, and a clean fresh writer revision.
Supplier creation, Contact resolution, payment methods and provenance commit in
one transaction. Reruns verify existing receipts; they do not create duplicates.
Rollback archives only owned rows after checking references and preserving MATCH
and shared Contacts. As with stock/history rollback, close database admission and
drain other sessions; the supplier rollback waits up to 60 seconds for that freeze.
Reverse history and stock before suppliers. No purchase order, debt, payment,
contract, commission or journal is created by supplier/history migration.

Stock `RESOLVE_STOCK.supplier` must explicitly link a verified supplier receipt
or use `NO_SUPPLIER` for a confirmed blank/self-purchase source. Unknown labels
block import. Existing products with another supplier are conflicts, not updates.
`MAP_STOCK_ITEM` is a single-row, checksum-bound exception for blank-category tablet
serials or accessories; exact original barcode/name/category must match.
`RETAIN_LEGACY_SALE` preserves malformed historical identity/category strings in
read-only history with exact original-value evidence; it does not repair IMEIs or
create stock. Monetary/date/coverage checks remain in force.

The sale occurrence migration retains existing rows as occurrence 1. Multiple
units with the same barcode, bill and timestamp require `DISTINCT_UNITS` evidence
covering the entire source group and contiguous occurrences. Repeated IMEIs in
other sale events remain separate. Existing occurrence-1 receipt fingerprints
remain compatible. Run the full isolated cutover suite after applying migrations.

An actual-workbook rehearsal can be run through `tools/test-db-vitest.sh` with
`TOOLTIFY_SUPPLIER_WORKBOOK` and `TOOLTIFY_REHEARSAL_OUT` set to private local paths
and `supplier-rehearsal.integration.spec.ts` selected. It records all pending rows,
rehearses only complete rows, verifies replay and reversal, and never connects to
the application database. Successful preparation is not a final cutover: refresh
exports at the confirmed freeze and resolve all remaining source/target issues.

### Supplier workbook binding and reversal

The supplier context must include `workbookPath`, pointing to the unchanged original Excel. `supplier-plan` re-parses the file and compares its SHA-256 and every parsed row with the inspection JSON; `supplier-apply` repeats that check. Dropping incomplete suppliers or editing inspected bank details is rejected. Correct the original workbook, inspect, and review a new plan instead. Direct-helper subset rehearsal is restricted to the isolated test harness and reports every pending supplier; it is not a production import plan.

Supplier reversal uses the same closed-admission/sole-backend handshake as stock reversal, with a READ COMMITTED transaction so it observes admission closing after the reported PID. Reverse stock first: an owned, unchanged product may release its original receipt-bound supplier FK when it is archived; the immutable stock receipt retains the supplier association. Unrelated archived/live products and later supplier changes remain blockers. No historical purchase or accounting document is synthesized.

An owner may explicitly leave a supplier phone blank: keep the phone cell blank and record the exact decision `เจ้าของยืนยันให้เว้นเบอร์โทรว่าง` on its own line in that supplier's notes. The original workbook SHA and full parsed input remain required at plan/apply. Only this evidenced blank maps to the existing Supplier phone field's empty string; other missing phones remain pending. Do not insert a dummy phone or infer the decision from a missing cell.

## Daily stock refresh: keep installment quotes aligned with the master

For the owner-reviewed Tooltify store `TOOLTIFY_3012`, the November 2026 migration
uses **THAI** for phones whose source export omits origin. Keep the owner's
confirmation as an evidence file. This is a store-specific migration policy,
not an inference that every Apple phone is Thai. Explicit source `IMPORTED`
stays imported; contradictory source and reviewed origins must be resolved.

After preparing the new snapshot, intake cash prices, supplier decisions and
exclusions for already imported physical units, run this file-only preparation
command from the repository root. Use a **new output directory for every review**:

```sh
./node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json \
  apps/api/src/cli/prepare-tooltify-stock-pricing.cli.ts \
  --manifest /absolute/path/to/new-round/manifest.json \
  --out-dir /absolute/path/to/new-round/master-reviewed \
  --store-key TOOLTIFY_3012 --default-origin THAI \
  --origin-evidence /absolute/path/to/owner-origin-confirmation.txt
```

The output retains evidenced cash and supplier links, fills only missing phone
origins, and uses `pricing: { mode: "MASTER_INSTALLMENTS", cashPrice: "…" }`.
It copies the origin evidence and binds its SHA-256 into the hashed decisions.
It never changes a database, existing review directory, QC decision or accessory.
Use the **output manifest** for the existing cutover dry-run/apply commands above.
Do not run a previous checkout or dated `.tmp/prepare-stock.ts` directly for new
production imports; those predate the origin guard and this preparation step.

At dry-run, `MASTER_INSTALLMENTS` selects current active BESTCHOICE/GFIN bases for
the exact model, category and normalized capacity, using the reviewed origin.
Missing capacity, missing/zero installment bases or an unknown origin on a ready
financed phone blocks import. Cash-only phones and QC remain available for review.
The selected master row is bound to the plan: a change before apply requires a
fresh dry-run. Existing same-batch replay uses immutable accepted receipts; a new
batch with conflicting prices/origins stops instead of overwriting existing stock.

Before accepting a daily refresh, compare **down payment, monthly amount and term**
as well as base prices with the current approved master. For the Thai used-phone
sheet approved on 23 Nov 2026, examples are iPhone 14 128GB: BESTCHOICE 1,800 /
1,411 × 12 and GFIN 0 / 2,000 × 12; iPhone 17 256GB: BESTCHOICE 3,800 / 3,023 × 12
and GFIN 3,900 / 3,060 × 15. Different origins, terms, or subsequently approved
master/rate changes legitimately change quotes; do not freeze these examples as
universal defaults. The shared quote regression and cutover integration tests
cover persisted origin, these calculations, changed-master rejection and replay.

Corrections after an import (such as the 23 Nov origin repair) have their own
normal product PATCH audit. **Never rewrite an old import receipt fingerprint**
to conceal an edited target. Keep the original import verification as historical
evidence and record the correction separately. Later daily snapshots exclude
already imported physical units after reconciliation, preserving legitimate edits.
