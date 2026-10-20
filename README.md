# Docdog — Unified HS Code Check (Official Customs · AD/Trade Remedies · ACFTA/Form E)

กรอก HS Code ครั้งเดียว → ตรวจ 3 แหล่งแยกกัน → แสดงผลในหน้าเดียว แต่ละส่วนมีสถานะ แหล่งที่มา วันที่ตรวจ เวอร์ชันเอกสาร และคำเตือนของตัวเอง

## สถานะการพัฒนา (ตามจริง)

| ส่วน | สถานะ |
|---|---|
| Unified check (3 checks, แยกความล้มเหลวต่อแหล่ง, timeout, history) | ทำแล้ว + มีเทสต์ผ่าน |
| ACFTA: upload → extract → review → approve → publish/supersede | ทำแล้ว + มีเทสต์ผ่าน (ใช้ PDF ที่สร้างเองมี text layer) |
| `NO_DATASET` / `NO_MATCH_IN_DATASET` ข้อความตรงสเปก | ทำแล้ว + มีเทสต์ผ่าน |
| AD/Trade Remedies | parser + adapter + ซิงก์เป็น snapshot ทำแล้ว; **parser ตรวจกับข้อความที่ render จากหน้า DFT จริงเท่านั้น ยังไม่เคยรันกับ raw HTML** |
| Official Customs | **ยังไม่มี integration** → คืน `MANUAL_CHECK_REQUIRED` + ลิงก์ (ไม่สร้างผลจำลอง) |
| Supabase migration + RLS | เขียนแล้ว **ยังไม่ได้ apply/ทดสอบกับ Supabase จริง** |
| Supabase store / API routes / UI | typecheck + `next build` ผ่าน **ยังไม่เคยรันกับ DB จริง** |
| OCR | มีแค่ interface (`OcrProvider`) ไม่มี provider จริง หน้าสแกนถูก flag ใน `ocr_required_pages` |
| E2E (Playwright) | **ยังไม่ได้ทำ** |
| Parser ของ ACFTA PDF | heuristic ตามสมมติฐาน (คอลัมน์แรก=HS, คอลัมน์สุดท้าย=อัตรา) **ต้องรอไฟล์จริงก่อนยืนยัน** |

## ผลตรวจแหล่งข้อมูล
- **กรมการค้าต่างประเทศ** (`thaitr.dft.go.th/th/measure_use`): ดึงได้ เป็นรายการ case พร้อมพิกัดหลายรูปแบบ (มีจุด/ไม่มีจุด/ข้อความอิสระ/พิมพ์ติดกัน) ไม่มี API ที่ยืนยันแล้ว จึงซิงก์เป็น snapshot (`scripts/sync-dft.ts`) และทุกผลลัพธ์มี `retrievedAt`. หน้ามี 2 หน้า ตัวซิงก์วนทุกหน้า และปฏิเสธเขียนทับถ้า parse ได้น้อยผิดปกติ ควรตรวจข้อกำหนดการใช้งานของเว็บก่อนตั้งซิงก์อัตโนมัติ
- **กรมศุลกากร** (`itd.customs.go.th/igtf/...`): เป็นหน้า frame ที่ไม่มีเนื้อหาให้ดึง และเป็น **HTTP ไม่ใช่ HTTPS** ดังนั้นการฝังด้วย iframe ในเว็บ HTTPS (เช่น Vercel) จะถูกเบราว์เซอร์บล็อกเป็น mixed content จึงไม่ฝัง ใช้ลิงก์เปิดแท็บใหม่แทน (ไม่ได้ทดสอบ header `X-Frame-Options` เพราะ sandbox เข้าโดเมนนี้ไม่ได้)

## กติกาที่บังคับในโค้ด
- ไม่พบ ≠ ไม่มีมาตรการ: AD ไม่พบ → `NO_MATCH_IN_SOURCE` + คำเตือน; ไม่มี snapshot → `NO_DATASET`; แหล่งล้ม → `SOURCE_ERROR`
- ประเทศต้นทางไม่อยู่ในรายชื่อ → เตือนให้ตรวจผู้ผลิต/ผู้ส่งออกและ AC ไม่สรุปว่ารอดพ้น; case สถานะ "ยุติ" แสดงเตือน
- ACFTA: ค่าที่เอกสารไม่มี = `null` + `missingFields` (ไม่ใช่ 0); "-" ในเอกสารเก็บเป็น `rateRaw="-"`, `rateValue=null`
- ค้นหาแบบ prefix สองทาง (4/6/8/11 หลัก) และระบุ `matchType` ให้เห็น
- ชุดข้อมูลค้นหาได้เฉพาะ record `APPROVED` ของเอกสาร `PUBLISHED`; แก้ไขหลังเผยแพร่ไม่ได้; แทนที่เวอร์ชันต้อง supersede อย่างชัดเจน; ไฟล์ PDF ต้นฉบับไม่ถูกเขียนทับ

## สิทธิ์
`admin` (อัปโหลด/เผยแพร่/จัดการ role), `reviewer` (ตรวจทาน อนุมัติ/ปฏิเสธ/แก้), `member` (ค้นหา) — คนเดียวถือหลาย role ได้ สมัครใหม่ได้เฉพาะ `member`.
สร้าง admin คนแรกครั้งเดียวใน SQL editor: `select public.bootstrap_first_admin('you@example.com');` (ต้องสมัครสมาชิกก่อน; ฟังก์ชันปฏิเสธถ้ามี admin แล้ว)

## วิธีนำไปใช้
```bash
npm install
cp .env.example .env.local        # ใส่ publishable key (service role key ใช้เฉพาะสคริปต์ซิงก์ ห้าม commit)
supabase login && supabase link --project-ref aqjastmhwtnzewfhdvtu
supabase db push                  # apply supabase/migrations/*
npm run typecheck && npm test
npx tsx scripts/sync-dft.ts       # ดึง snapshot มาตรการ (ต้องมี SUPABASE_SERVICE_ROLE_KEY)
npm run dev                       # /hs-check  และ /admin/acfta
```
Deploy: Vercel + ตั้ง env 2 ตัวแรก (ไม่ต้องใส่ service role key บน Vercel ถ้าไม่ใช้ซิงก์จากที่นั่น)

## สมมติฐาน
- repo `Docdog` ว่างเปล่า (ไม่มี commit) จึงสร้างเป็น Next.js 15 App Router + TypeScript + Vitest; ไม่มีโค้ด LINE Bot ใน repo นี้ให้กระทบ
- ประมวลผล PDF แบบ synchronous ใน route (`maxDuration=60`) เหมาะกับไฟล์ขนาดกลาง ไฟล์ใหญ่ควรย้ายไป background job
- อ่านพิกัด ACFTA เฉพาะแถวที่คอลัมน์แรกเป็นเลข 6–11 หลัก; แถวหัวข้อ 4 หลักถูกข้ามโดยตั้งใจจนกว่าจะเห็นไฟล์จริง
- หน้า DFT ครอบคลุม "สินค้าที่ไทยใช้มาตรการ" (สินค้านำเข้าไทย) ไม่รวม "สินค้าไทยที่ถูกใช้มาตรการ"

## ต้องรอ/ต้องทำต่อ
1. ไฟล์ ACFTA PDF จริง → ปรับ parser, ทดสอบ extraction, เติม conditions/effective period
2. ตัดสินใจ OCR provider (Tesseract/cloud) แล้วเขียน `OcrProvider`
3. ช่องทาง Official Customs ที่ยืนยันแล้ว → implement `OfficialCustomsLookup`
4. apply migration กับ Supabase จริงแล้วทดสอบ RLS ด้วยผู้ใช้ 3 role
5. Playwright E2E, ตรวจ raw HTML ของ DFT ก่อนเปิดซิงก์อัตโนมัติ
