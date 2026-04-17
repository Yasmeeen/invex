# Roles and permissions

This application uses **role-based access**. The UI (sidebar and routes) and the backend **both** enforce rules; never assume “if the link is hidden, the API is open”—QA should verify API responses for forbidden roles where relevant.

## Role names (canonical)

| Role | Notes |
|------|--------|
| **Super Admin** | Full access including dashboard (`/home`) and **profit** report. May act across **all branches** when filters allow. |
| **Co Admin** | Broad admin access; **no** dashboard route (`/home`), **no** profit report (UI + menu + server policy for Vixa tools). |
| **Branch Manager** | Branch-scoped operations; **no** Users, Branches, or Store Settings; **no** profit report. |
| **Warehouse** | Legacy name **Operation Manager** is still accepted in the database and treated as **Warehouse**. Inventory, products, branches, categories, orders, reports (including profit where allowed), etc.—see sidebar `Warehouse` in `siderbars.ts`. |
| **Cashier** | Orders and Cashier; Vixa. |
| **Moderator** | **Products** (view) and **Vixa** only; booking flows are tied to products as implemented. |

## Branch scoping

- **Super Admin** and **Co Admin** can often select branch context in filters (global view).
- Other roles are typically limited to **their assigned branch** (or warehouse rules as implemented). Exact behaviour is enforced in services and should be validated per module.

## Profit report (special rule)

- **Co Admin** and **Branch Manager** **must not** open the **Profit** report page. The app redirects them to **Sales** report if they attempt `/reports/profit` (`ProfitReportGuard`).
- **Vixa** follows the same idea server-side: profit tools are denied for those roles (see `backend/src/modules/ai_module/policy.js`).

## Reports availability (UI)

Reports routes are available to **Super Admin**, **Co Admin**, **Branch Manager**, and **Warehouse** (see `main-routing.module.ts`). **Cashier** and **Moderator** do not have the reports module in routing.

## Vixa (AI)

- Any **authenticated** user can open **Vixa** (route guard).
- **Answers** still depend on **server-side** permission for sales / profit / bookings / external search—users without report rights should get a permission or fallback message, not raw data.
