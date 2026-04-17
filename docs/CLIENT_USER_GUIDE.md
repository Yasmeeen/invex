# Client user guide

This guide explains **what the system is for** and **how to use each main area**. Wording is for **end users** (store staff and managers). For exact technical test steps, see [QA_TESTING_GUIDE.md](./QA_TESTING_GUIDE.md).

---

## 1. Signing in and account security

- Open the application URL provided by your administrator.
- Sign in with the credentials issued to you.
- If you forget your password, your organisation’s policy applies: typically a **Super Admin** or **Co Admin** can set a new password from **Users** (in-app reset)—there is no reliance on email self-service unless your deployment adds it.
- After a password change, you may be redirected to sign in again.

**Interface language**: You can switch UI language where the app exposes a language control.  
**Receipt / invoice language**: Printed receipts may follow **Store settings** (receipt language), which can differ from the UI language.

---

## 2. Home dashboard

- Available to **Super Admin** (as configured in routing).
- Shows high-level indicators (e.g. sales-related summaries, recent activity—exact widgets depend on your build).

---

## 3. Products

**Purpose**: Maintain the product catalog: codes, pricing, discounts, categories, branch assignment, stock-related fields, images, and **booking** options where enabled.

**Typical tasks**

- Create or edit a product; assign it to a **category** and **branch** as required.
- Use **barcode / QR** features if your workflow includes scanning.
- **Bookings**: For eligible products, staff may create or manage reservations (deposit, customer details, pickup/shipping). Confirmed bookings can trigger notifications.

**Notes**

- Some roles can only manage products for **their branch**.
- **Moderator** may have **view-only** catalog access with booking actions as allowed by your role.

---

## 4. Categories

**Purpose**: Group products and often define **short codes** used as prefixes for product codes.

**Typical tasks**

- Create categories before bulk product creation if codes are generated from category prefixes.

---

## 5. Branches

**Purpose**: Define store locations (name, address, and operational fields such as rent, salaries, branch invoices, expenses—used in **profit** calculations where entered).

**Who can access**: Super Admin, Co Admin, Warehouse (not Branch Manager by default menu).

---

## 6. Inventory (stock & movements)

**Purpose**: View and adjust stock, transfer between **warehouse** and **branches**, and track movements as implemented.

**Typical tasks**

- Transfer stock to a branch.
- Review availability; bookings may **reserve** units—labels often show reserved vs sellable quantity.

---

## 7. Users

**Purpose**: Create and maintain staff accounts: name, email, role, and **branch** (when applicable).

**Important**

- **Super Admin** and **Co Admin**–type roles may be **global** (not tied to one branch)—follow on-screen hints when editing users.

**Who can access**: Super Admin, Co Admin.

---

## 8. Store settings

**Purpose**: Store name, phone, **logo**, and **receipt language** (for printed invoices/receipts in cashier and order flows).

**Who can access**: Super Admin, Co Admin.

---

## 9. Cashier (point of sale)

**Purpose**: Build a sale line-by-line, apply discounts, take payment, and **print** a receipt.

**Typical tasks**

- Scan or add products; complete client fields if required.
- Complete payment; print receipt. Logo and text direction may follow **receipt language** settings.

---

## 10. Orders (invoices / sales records)

**Purpose**: Create and manage orders (including add-order / invoice flows outside the quick cashier path, depending on your process).

**Typical tasks**

- Create an order, assign client details, payment method, discounts, and print.

---

## 11. Clients

**Purpose**: Customer directory for sales and follow-up (as implemented).

**Who can access**: Super Admin, Co Admin, Branch Manager.

---

## 12. Suppliers

**Purpose**: Maintain supplier records for purchasing workflows.

**Who can access**: Super Admin, Co Admin, Branch Manager.

---

## 13. Purchasing (requests)

**Purpose**: Create and track **purchasing requests** (items, supplier, status).

**Who can access**: Super Admin, Co Admin, Branch Manager.

---

## 14. Reports

Available report types (exact charts/tables depend on your data):

| Report | What it helps with |
|--------|---------------------|
| **Sales** | Revenue, orders, trends, payment mix (as implemented). |
| **Profit** | Revenue, cost, trading profit, **branch operating costs** (when branch fields are filled), **net profit**. **Not available** to Co Admin / Branch Manager (by design). |
| **Products** | Product performance. |
| **Stock** | Stock movements. |
| **Customers** | Customer analytics. |
| **Installments** | Installment-related totals (where used). |
| **Bookings** | Booking statistics and lists. |

Use **date range** and **branch** filters where shown. Export options (e.g. Excel/PDF) depend on the screen.

---

## 15. Audit log

**Purpose**: Review **who did what** (and when) for accountability.

**Who can access**: Super Admin, Co Admin.

---

## 16. Vixa (AI assistant)

**Purpose**: Ask questions in **natural language** about the store—especially **sales, profit, bookings** for a date range.

**Behaviour**

- Prefer questions like “sales today”, “bookings today”, “profit this week”, or Arabic equivalents.
- Answers use **your permissions**: if you cannot open a report in the UI, Vixa should not expose that data.
- If **external AI** or **web search** is disabled or misconfigured, you may see a short fallback message; **internal numbers** from reports may still work.

---

## 17. Notifications

**Purpose**: In-app alerts (e.g. booking-related events). Use the notification list in the header; **mark as read** as needed.

---

## 18. Getting help

- Contact your **system administrator** for new accounts, role changes, or branch setup.
- For incorrect numbers, verify **date range**, **branch filter**, and that **branch cost fields** are entered for profit breakdowns.
