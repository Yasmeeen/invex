# Platform documentation (complete edition)

*This single file merges all guides for PDF export. Editable sources: `README.md`, `CLIENT_USER_GUIDE.md`, `QA_TESTING_GUIDE.md`, `ROLES_AND_PERMISSIONS.md`.*

---

# Part 1 — Overview

English documentation for the **e‑commerce / retail operations** web application (Angular frontend + Node.js/MongoDB backend).

| Section | Audience | Purpose |
|---------|----------|---------|
| Part 2 | Store staff, managers, **clients** | Day-to-day usage |
| Part 3 | **QA** engineers | Test planning and regression |
| Part 4 | QA, admins, support | Roles and permissions |

## Product scope (high level)

- **Multi-branch retail**: products, categories, stock, transfers, sales (orders/invoices), cash desk, customers, suppliers, purchasing requests.
- **Reporting**: sales, profit (restricted roles), products, stock movements, customers, installments, bookings.
- **Product bookings**: reserve units with deposits; notifications and confirmations.
- **Vixa**: in-app AI assistant; internal reports when possible; optional external AI / web search per server configuration.
- **Audit log**: Super Admin / Co Admin.
- **Store settings**: branding, contact, receipt language, logo.

## Technical references

- Frontend routes: `frontend/src/app/main/main-routing.module.ts`
- Sidebar menus: `frontend/src/app/shared/resources/siderbars.ts`
- Backend API: `backend/src/bootstrap.js`
- AI: `backend/src/modules/ai_module/`
- Environment: `backend/.env.example`

---

# Part 2 — Client user guide

This guide explains **what the system is for** and **how to use each main area** (end users: store staff and managers).

## 1. Signing in and account security

- Open the application URL provided by your administrator.
- Sign in with the credentials issued to you.
- If you forget your password, your organisation’s policy applies: typically a **Super Admin** or **Co Admin** can set a new password from **Users** (in-app reset).
- After a password change, you may be redirected to sign in again.

**Interface language**: Switch where the app exposes a language control.  
**Receipt / invoice language**: Printed receipts may follow **Store settings** (receipt language), which can differ from the UI language.

## 2. Home dashboard

- Available to **Super Admin** (as configured in routing).
- High-level indicators (exact widgets depend on your build).

## 3. Products

**Purpose**: Product catalog: codes, pricing, discounts, categories, branch assignment, stock, images, **booking** options where enabled.

**Typical tasks**: Create/edit products; barcode/QR; **bookings** (deposit, customer, pickup/shipping); notifications on confirmation.

**Notes**: Some roles are branch-scoped; **Moderator** may be view-only with booking as allowed.

## 4. Categories

Group products; **short codes** often prefix product codes. Create categories before bulk coding if prefixes are required.

## 5. Branches

Store locations; operational fields (rent, salaries, branch invoices, expenses) feed **profit** where entered. Access: Super Admin, Co Admin, Warehouse (not Branch Manager in default menu).

## 6. Inventory

Stock and transfers between **warehouse** and **branches**; movements as implemented. Bookings may reserve units.

## 7. Users

Staff accounts: role and branch. Global admin roles may not be tied to one branch. Access: Super Admin, Co Admin.

## 8. Store settings

Store name, phone, **logo**, **receipt language**. Access: Super Admin, Co Admin.

## 9. Cashier

Point of sale: lines, discounts, payment, **print**. Receipt follows receipt language / logo settings.

## 10. Orders

Orders/invoices outside quick cashier path per your process.

## 11. Clients

Customer directory. Access: Super Admin, Co Admin, Branch Manager.

## 12. Suppliers

Supplier records. Access: Super Admin, Co Admin, Branch Manager.

## 13. Purchasing

Purchasing requests. Access: Super Admin, Co Admin, Branch Manager.

## 14. Reports

| Report | Purpose |
|--------|---------|
| Sales | Revenue, orders, trends, payment mix |
| Profit | Revenue, cost, trading profit, branch costs, net profit — **not** for Co Admin / Branch Manager |
| Products | Product performance |
| Stock | Movements |
| Customers | Analytics |
| Installments | Where used |
| Bookings | Booking stats/lists |

Use date range and branch filters; export per screen.

## 15. Audit log

Who did what, when. Access: Super Admin, Co Admin.

## 16. Vixa (AI)

Natural language questions; **sales, profit, bookings** and date ranges. Answers respect **your** permissions. External AI/search may be unavailable—internal numbers may still work.

## 17. Notifications

In-app alerts (e.g. bookings); mark as read.

## 18. Getting help

Administrator for accounts and branches. For numbers: check **date range**, **branch**, and **branch cost fields** for profit.

---

# Part 3 — QA testing guide

## 1. Test environments and data

| Topic | Recommendation |
|-------|----------------|
| Environments | **Staging** with realistic subset of production data |
| Users | One user per **role** with known branch |
| Seed data | Categories with codes, branches, products, bookings, dated orders, suppliers/clients if needed |
| Backend | MongoDB; optional Cloudinary; AI keys optional for Vixa external paths |

## 2. Role × module matrix (smoke)

| Area | Super Admin | Co Admin | Branch Manager | Warehouse | Cashier | Moderator |
|------|-------------|----------|----------------|-----------|---------|-----------|
| `/home` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Products | ✓ | ✓ | ✓ | ✓ | ✗ | view + booking rules |
| Categories | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Branches | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Users | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Settings | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Inventory | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Orders | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Cashier | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |
| Clients/Suppliers/Purchasing | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Reports (any) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Reports → Profit | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Audits | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Vixa | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**Deep checks**: ProfitReportGuard redirects Co Admin / Branch Manager from `/reports/profit` to `/reports/sales`. Branch isolation for non-global roles. Legacy **Operation Manager** = **Warehouse**.

## 3. Authentication & session

Login, logout, password update, deep-link denial for forbidden routes.

## 4. Core commerce flows

**Products & categories**: CRUD, validation, code prefix rules, image upload.  
**Inventory**: Transfers, booked vs available.  
**Orders & cashier**: Lifecycle, receipt logo/direction/formatting, client validation.  
**Bookings**: Create/cancel/confirm, notifications, report alignment.

## 5. Reports

Each type: empty state, dates, branch filter, export. Profit: branch overhead fields and net vs trading profit; no profit for Co Admin / BM (UI + Vixa).

## 6. Purchasing & master data

Suppliers, purchasing requests, clients.

## 7. Settings

Persist name, phone, logo, receipt language; reflect in UI and prints.

## 8. Audit log

Verify entries for sensitive actions.

## 9. Notifications

Booking triggers; read/all read; no duplicate errors.

## 10. Vixa API

| # | Case | Expectation |
|---|------|-------------|
| 1 | “sales today” EN/AR | Summary, sales intent |
| 2 | Arabic invoice/sales phrasing | Sales intent, no 500 |
| 3 | Profit this week / أرباح الأسبوع | Profit intent, week range when no ISO dates |
| 4 | Co Admin profit question | 403 or denial, no raw profit |
| 5 | No AI key / provider error | Graceful message |
| 6 | SerpApi off | No crash on pricing path |

UI: floating widget vs full `/vixa` page.

## 11. API smoke

Endpoints under `/api/*` as in `bootstrap.js`; unauthenticated access blocked; AI rate limit if enabled.

## 12. Non-functional

i18n, RTL, performance, security.

## 13. Regression buckets

Login/roles → product/order/print → inventory/booking → reports/profit → settings/receipt → notifications → Vixa → audit.

---

# Part 4 — Roles and permissions

**Role-based access**: UI and backend both enforce rules.

| Role | Notes |
|------|--------|
| **Super Admin** | Full access including `/home` and **profit** report; global branch filters. |
| **Co Admin** | No `/home`, **no profit** report (UI, menu, Vixa tools). |
| **Branch Manager** | No Users, Branches, Settings; **no profit** report. |
| **Warehouse** | Legacy **Operation Manager** treated as Warehouse. |
| **Cashier** | Orders, Cashier, Vixa. |
| **Moderator** | Products (view) + Vixa; bookings per product rules. |

**Branch scoping**: Super Admin and Co Admin often have global filters; others typically branch-scoped.

**Profit**: Co Admin / Branch Manager cannot open profit; Vixa denies profit tools for them.

**Reports routing**: Super Admin, Co Admin, Branch Manager, Warehouse — not Cashier/Moderator.

**Vixa**: Authenticated users can open; server enforces data permissions.
