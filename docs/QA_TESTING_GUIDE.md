# QA testing guide

This document supports **test planning**, **regression**, and **sign-off** for the e‑commerce / retail operations platform. Pair it with [ROLES_AND_PERMISSIONS.md](./ROLES_AND_PERMISSIONS.md) and the [Client user guide](./CLIENT_USER_GUIDE.md) for business context.

---

## 1. Test environments and data

| Topic | Recommendation |
|-------|----------------|
| **Environments** | Maintain at least **staging** with production-like data volume (smaller subset). |
| **Users** | One user per **role** (see matrix below) with known branch assignment. |
| **Seed data** | Categories with **codes**, branches, products across branches, at least one **booking**, orders spanning dates, suppliers/clients if purchasing is in scope. |
| **Backend** | MongoDB connection; optional **Cloudinary** for uploads; AI keys optional for Vixa external paths. |

---

## 2. Role × module matrix (smoke)

Use ✓ = route/menu expected, ✗ = must not access, **partial** = branch-scoped or read-only—verify in app.

| Area | Super Admin | Co Admin | Branch Manager | Warehouse | Cashier | Moderator |
|------|-------------|----------|----------------|-----------|---------|-----------|
| `/home` dashboard | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Products | ✓ | ✓ | ✓ | ✓ | ✗ | view + booking per product rules |
| Categories | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Branches | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Users | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Settings | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Inventory | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Orders | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Cashier | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |
| Clients / Suppliers / Purchasing | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Reports (any) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Reports → **Profit** | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Audits | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Vixa (page + widget) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**Deep checks**

- **ProfitReportGuard**: Co Admin / Branch Manager navigating to `/reports/profit` → redirected to `/reports/sales`.
- **Branch isolation**: Non-global roles should not mutate or see other branches’ restricted entities—verify per module (products, orders, inventory).
- **Legacy role**: User stored as **Operation Manager** should behave as **Warehouse** (`LEGACY_OPERATION_MANAGER`).

---

## 3. Authentication & session

- Login success / failure; token persistence; logout.
- **Password update** (admin path): after update, user can log in with new password; session handling as specified.
- **Unauthorized** access to deep links (URL paste) for forbidden routes.

---

## 4. Core commerce flows

### 4.1 Products & categories

- CRUD happy paths; validation (required fields, price, branch, category).
- Category **short code** vs product code prefix rules (mismatch errors).
- Image upload: success and failure (size/type); Cloudinary vs local fallback if applicable.

### 4.2 Inventory & transfers

- Transfer from warehouse to branch; negative/edge quantities blocked.
- Display of **booked** vs **available** stock on product/cashier where shown.

### 4.3 Orders & cashier

- Order lifecycle: create, pay, discount modes, tax, print.
- **Receipt**: logo from settings; **direction** LTR/RTL per receipt language; numbers formatting (no decimals if that build enforces it).
- **Cashier** client validation when required.

### 4.4 Bookings

- Create booking; capacity limits; cancel; confirm (if applicable); **notifications** to relevant users.
- Reports → **Bookings** aligns with same data.

---

## 5. Reports (functional)

For each report type: empty state, single day, multi-day, branch filter, export/print if present.

**Profit report (extra)**

- With branch fields: rent, salaries, branch invoices, expenses → verify **daily allocation** logic and **net profit** vs trading profit labels.
- Co Admin / Branch Manager: **no access** to profit screen and no profit tool via Vixa.

---

## 6. Purchasing & master data

- Suppliers CRUD; purchasing request create/edit; status transitions.
- Clients list behaviour.

---

## 7. Settings

- Save store name, phone, logo, receipt language; verify reflection in **header/sidebar/printed invoice** as implemented.

---

## 8. Audit log

- Generate auditable actions (user update, product change, etc.—per implementation) and confirm entries: actor, time, module, entity.

---

## 9. Notifications

- Trigger booking-related notification; list shows entry; mark read / mark all read; no duplicate toast errors.

---

## 10. Vixa (`/api/ai/chat`)

**Automated ideas**

| # | Case | Expectation |
|---|------|-------------|
| 1 | Authenticated user, “sales today” (EN/AR) | JSON `answer` with summary; `meta.intent` sales-related. |
| 2 | Arabic phrasing for invoices/sales (multiple spellings) | Intent **sales**, not 500. |
| 3 | “Profit this week” / Arabic **أرباح الأسبوع** | Intent **profit**, date range covers **current week** (Mon–Sun local) when no explicit ISO dates in message. |
| 4 | Co Admin asks profit | 403 or permission message from tool layer—not raw profit numbers. |
| 5 | No `AI_API_KEY` / provider error | Graceful JSON message, not 500. |
| 6 | `INTERNET_ALLOWED` / SerpApi off | Pricing path does not crash; user-informed message. |

**UI**

- Floating widget on all main pages; full page `/vixa`; floating hidden on `/vixa` if that behaviour is still required—verify.

---

## 11. API smoke (optional checklist)

From `bootstrap.js`: `/api/products`, `/api/categories`, `/api/branches`, `/api/orders`, `/api/users`, `/api/vendors`, `/api/purchasing`, `/api/dashboard`, `/api/clients`, `/api/settings`, `/api/uploads`, `/api/reports`, `/api/product-bookings`, `/api/notifications`, `/api/audits`, `/api/ai`.

- Unauthenticated requests should not return sensitive data.
- Rate limiting on AI route if enabled—burst requests.

---

## 12. Non-functional

- **i18n**: Switch EN/AR/FR/DE for main labels; Vixa prompts translate.
- **RTL**: Sidebar and forms; receipt direction independent of UI language.
- **Performance**: Large product lists, report date ranges.
- **Security**: No secrets in frontend bundle; CORS as deployed.

---

## 13. Regression buckets (release checklist)

1. Login + role menus  
2. Product + order + print  
3. Inventory transfer + booking  
4. Reports (each type) + **profit restriction**  
5. Settings + receipt  
6. Notifications  
7. Vixa (internal tools + error fallbacks)  
8. Audit sampling  
