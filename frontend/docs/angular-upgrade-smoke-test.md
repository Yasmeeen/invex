# Angular upgrade smoke test checklist

Run after `nvm use` (see [`.nvmrc`](../.nvmrc)) and `npm install` in `frontend/`.

```bash
cd frontend
nvm use
npm install
npm run build
npm start
```

## Critical paths

| Area | Steps | Pass |
|------|--------|------|
| Auth | Login, logout, session refresh | [ ] |
| Products | List, create/edit product, import dialog | [ ] |
| Cashier | Open cashier, add items, checkout / QR | [ ] |
| Orders | List, add order, pay order dialog | [ ] |
| Purchasing | List requests, create/edit request | [ ] |
| Home / reports | Dashboard KPIs, charts render | [ ] |
| i18n | Switch AR/EN, labels load | [ ] |
| RTL | Layout in Arabic | [ ] |

## Build / deploy

- [ ] `npm run build` succeeds without `NODE_OPTIONS=--openssl-legacy-provider`
- [ ] Heroku (if used): `heroku-postbuild` uses Node 20+ and production configuration

## Known follow-ups

- **Angular Material 16 (legacy)** is pinned while **Angular core is 21**. UI works in production build; plan `ng generate @angular/material:mdc-migration` to move to Material 21 MDC components.
- **angular-font-awesome** remains; consider `@fortawesome/angular-fontawesome` long term.
