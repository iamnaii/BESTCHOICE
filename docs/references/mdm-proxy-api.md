# MDM Proxy API — PJ-Soft (mdm-th.com)

## Overview

```
Base URL        : https://mdm-th.com
Authentication  : API Key via Header "X-API-Key"
Content-Type    : application/json
Rate Limit      : 100 requests / 60s sliding window
Total Endpoints : 40
```

## Response Format

Success: `{ "code": 200, "msg": "Operation successful", "data": { } }`
Error:   `{ "error": "error_code", "message": "...", "reference_id": "..." }`

## Rate Limit Headers

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Max requests per window (100) |
| `X-RateLimit-Remaining` | Remaining requests |
| `X-RateLimit-Reset` | Unix timestamp for reset |

HTTP 429 when exceeded — use exponential backoff.

## Error Codes

| HTTP | Code | Description |
|------|------|-------------|
| 401 | `missing_api_key` | No API Key in header |
| 401 | `invalid_api_key` | Invalid/deactivated key |
| 403 | `provider_not_approved` | Pending admin approval |
| 403 | `endpoint_not_allowed_for_provider` | Endpoint not enabled |
| 422 | `validation_error` / `missing_required_field` | Invalid input |
| 429 | `rate_limited` | Rate limit exceeded |
| 500 | `internal_error` / `upstream_error` | Server error |

## All 40 Endpoints

### Authentication (1)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 1 | POST | `/api/mdm/get-authorization` | Get auth token |

### Account Management (1)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 2 | POST | `/api/mdm/account/add` | Add sub account |

### Device Management (13)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 3 | GET | `/api/mdm/devices` | List devices (pageNum, pageSize, status, modelType, isDel, lossStatus, name, phone, deviceId) |
| 4 | GET | `/api/mdm/devices/types` | Device types (iPhone/iPad/Mac) |
| 5 | GET | `/api/mdm/devices/{id}` | Device by ID |
| 6 | GET | `/api/mdm/devices/imei/{imei}` | Device by IMEI |
| 7 | GET | `/api/mdm/devices/by-serial?deviceId=XXX` | Device by serial |
| 8 | GET | `/api/mdm/devices/phone` | Query device phone |
| 9 | GET | `/api/mdm/devices/phone/history` | Phone history |
| 10 | GET | `/api/mdm/devices/location?id=XXX` | GPS location |
| 11 | POST | `/api/mdm/devices` | Add device (deviceId*, name*, phone*) |
| 12 | POST | `/api/mdm/devices/edit` | Edit device (id*, name*, phone*, deviceName*, isDel*) |
| 13 | POST | `/api/mdm/devices/get-info` | Check device info |
| 14 | POST | `/api/mdm/devices/update` | Update device |
| 15 | POST | `/api/mdm/devices/lock` | Lock device screen |

### Application Management (4)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 16 | GET | `/api/mdm/apps?pageNum=&pageSize=` | List apps |
| 17 | GET | `/api/mdm/devices/apps/{id}` | Apps on device |
| 18 | POST | `/api/mdm/apps/install` | Install app (id*, appId*) |
| 19 | POST | `/api/mdm/apps/restrictions` | Restrict app (id*, bundleId*, restricted*) |

### Security (7)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 20 | GET | `/api/mdm/devices/activation-lock/query` | Query activation lock |
| 21 | POST | `/api/mdm/devices/lost-mode` | Enable Lost Mode (id*, dialPhone*, message*) |
| 22 | POST | `/api/mdm/devices/lost-mode/disable` | Disable Lost Mode (id*) |
| 23 | POST | `/api/mdm/devices/activation-lock` | Send activation lock |
| 24 | POST | `/api/mdm/devices/update-system` | Update OS |
| 25 | POST | `/api/mdm/devices/lock-screen-password` | Remove lock screen password |
| 26 | POST | `/api/mdm/devices/activation-lock/remove` | Remove activation lock |

### Policies & Restrictions (6)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 27 | GET | `/api/mdm/wallpapers` | List wallpapers |
| 28 | GET | `/api/mdm/wallpapers/{id}` | Wallpaper by ID |
| 29 | GET | `/api/mdm/restrictions/{id}` | Device restrictions |
| 30 | POST | `/api/mdm/restrictions` | Install restrictions (id*, allowCamera?, allowScreenCapture?, etc.) |
| 31 | POST | `/api/mdm/wallpaper/set` | Set wallpaper (id*, imageId*) |
| 32 | POST | `/api/mdm/devices/lock-screen-text` | Set lock screen text (id*, message*) |

### Verification (4)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 33 | GET | `/api/mdm/password/verify-required` | Check if password verify needed |
| 34 | GET | `/api/mdm/verification/send` | Send verification code |
| 35 | POST | `/api/mdm/password/secondary` | Set secondary password |
| 36 | POST | `/api/mdm/phone/modify` | Modify account phone |

### Operations & Logs (1)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 37 | GET | `/api/mdm/devices/operations` | Operation logs |

### Advanced Operations (3) — ⚠️ Destructive
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 38 | POST | `/api/mdm/devices/unlock` | One Click Unlock (removes MDM!) |
| 39 | POST | `/api/mdm/devices/abm/unbind` | Unbind ABM |
| 40 | POST | `/api/mdm/devices/erase` | ⚠️ WIPE device |

## BESTCHOICE Usage

**Core flow (overdue contracts):**
1. Find device: `GET /api/mdm/devices/imei/{imei}`
2. Enable Lost Mode: `POST /api/mdm/devices/lost-mode` (lock + show message)
3. Disable Lost Mode: `POST /api/mdm/devices/lost-mode/disable` (after payment)

**⚠️ WARNING:** `/api/mdm/devices/unlock` is NOT "disable lost mode" — it removes the MDM profile entirely!
