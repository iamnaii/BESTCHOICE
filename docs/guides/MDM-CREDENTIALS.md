# MDM PJ-Soft Credentials Runbook

ระบบเชื่อมกับ MDM PJ-Soft ผ่าน API Key สำหรับ remote lock/unlock เครื่องที่ขายผ่อน
เอกสารนี้อธิบายวิธี rotate API key โดยไม่มี downtime.

## Credential Fields

| Integration key | Field key           | Env var                | ใช้เมื่อ                                 |
|-----------------|---------------------|------------------------|------------------------------------------|
| `mdm`           | `apiKey`            | `MDM_API_KEY`          | คีย์ใช้งานปัจจุบัน (primary)            |
| `mdm`           | `apiKeyPrevious`    | `MDM_API_KEY_PREVIOUS` | คีย์เก่า — ใช้ fallback ช่วง grace period |
| `mdm`           | `baseUrl`           | `MDM_BASE_URL`         | MDM API base URL (default mdm-th.com)    |

ทั้ง `apiKey` และ `apiKeyPrevious` ถูก mark `sensitive: true` — UI จะ mask
และ audit log จะไม่แสดงค่าจริง.

## Rotation Flow (Zero-Downtime)

**Goal**: rotate API key โดยที่ request ที่ลอยอยู่ใน flight ตอน rotate ไม่ล้มเหลว.

1. **Generate new key** จาก MDM PJ-Soft dashboard (เก็บ old key ไว้ — อย่าเพิ่ง revoke).
2. **Set previous-key slot**:
   ```
   MDM_API_KEY_PREVIOUS = <OLD_KEY>
   MDM_API_KEY          = <NEW_KEY>
   ```
   Deploy ให้ env vars ทั้งสองตัวถูก apply พร้อมกัน.
3. **Grace period 24 ชม.** — MDM service ลอง `apiKey` ก่อน, ถ้าได้ 401 จะ fallback เป็น `apiKeyPrevious`.
   - ช่วงนี้ถ้า MDM provider cache คีย์เก่าอยู่ ระบบจะ degrade อย่างนุ่มนวลไม่ error ออกมา.
4. **หลัง 24 ชม.** → revoke old key ที่ MDM dashboard + clear `MDM_API_KEY_PREVIOUS=''` (หรือลบ env var).
5. **ตรวจสอบ log** — หาว่ามี fallback เกิดขึ้นกี่ครั้ง (grep `MDM fallback to previous key`). ถ้าเป็น 0 → rotation สำเร็จสะอาด.

## Notes

- PR ปัจจุบันเพิ่มแค่ **structural support** ใน registry (field `apiKeyPrevious`). Dual-key fallback logic ใน MDM service เป็นงานแยก (todo).
- เมื่อ implement dual-key logic จริง ต้อง emit metric/log ทุกครั้งที่ fallback เกิดเพื่อ monitor grace period.
- ห้าม commit API keys ลง git — set ผ่าน env var บน Cloud Run เท่านั้น.
