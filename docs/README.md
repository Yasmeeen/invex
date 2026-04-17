# Platform documentation

English documentation for the **e‑commerce / retail operations** web application (Angular frontend + Node.js/MongoDB backend).

## Printable PDF

- **Recommended:** Export Markdown yourself for **better layout** — see **[EXPORT_TO_PDF.md](./EXPORT_TO_PDF.md)** (Typora, VS Code “Markdown PDF”, Pandoc, Word, browser print, etc.).
- **Optional quick export (basic quality):** [`PLATFORM_DOCUMENTATION.pdf`](./PLATFORM_DOCUMENTATION.pdf) — generated from [`PLATFORM_DOCUMENTATION_COMPLETE.md`](./PLATFORM_DOCUMENTATION_COMPLETE.md) via `docs/generate_pdf.py` (simple typography; many teams prefer the methods in `EXPORT_TO_PDF.md` instead).

```bash
# Optional: regenerate the basic PDF (macOS + Python + fpdf2)
python3 -m pip install --user fpdf2
python3 docs/generate_pdf.py
```

| Document | Audience | Purpose |
|----------|----------|---------|
| [CLIENT_USER_GUIDE.md](./CLIENT_USER_GUIDE.md) | Store staff, managers, **clients** using the system day to day | What each area does, how to complete common tasks, and role limitations in plain language |
| [QA_TESTING_GUIDE.md](./QA_TESTING_GUIDE.md) | **QA** engineers | Test focus, role/permission matrix, suggested scenarios, and regression buckets |
| [ROLES_AND_PERMISSIONS.md](./ROLES_AND_PERMISSIONS.md) | QA, admins, support | Canonical list of roles and what they can access |

## Product scope (high level)

- **Multi-branch retail**: products, categories, stock, transfers, sales (orders/invoices), cash desk, customers, suppliers, purchasing requests.
- **Reporting**: sales, profit (restricted roles), products, stock movements, customers, installments, bookings.
- **Product bookings**: reserve units with deposits; notifications and confirmations.
- **Vixa**: in-app AI assistant for natural-language questions; answers use **internal reports** when possible; optional external AI and web search depend on server configuration.
- **Audit log**: trace sensitive actions (Super Admin / Co Admin).
- **Store settings**: branding, contact, receipt language, logo (used in UI and printed invoices where implemented).

## Technical references (for implementers)

- Frontend routes: `frontend/src/app/main/main-routing.module.ts`
- Sidebar menus by role: `frontend/src/app/shared/resources/siderbars.ts`
- Backend API mount points: `backend/src/bootstrap.js`
- AI behaviour and tool policy: `backend/src/modules/ai_module/`

For deployment and environment variables, see `backend/.env.example`.
