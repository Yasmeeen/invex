# Refactor backlog

Tracked follow-ups that improve consistency without blocking current features.  
Add new items at the bottom; keep the first item as the highest-priority structural cleanup unless priorities change.

---

## 1. Unify payment methods: one source for sale and purchase

**Status:** open  
**Why:** Yes — a single source is better. Today sale and purchase use parallel catalogs and UIs, so branch filtering and new methods must be wired twice (and often get missed).

### Current state

| Path | Source | UI | Branch filter |
|------|--------|----|---------------|
| Sale / client collection | `paymentMethodsCatalog` + `buildCashierPaymentMethods()` | Shared `PaymentSplitsDialog` | Works when caller passes `branchId` (cashier + recent openers) |
| Purchase / supplier pay | `purchaseTreasuryMethods` (derived from catalog) | Local multi-selects in several dialogs | Not filtered by branch |
| Outliers | Static lists | `add-order` (cash/online), `vendor-opening-debit` | None |

Key files:

- `frontend/src/app/shared/components/payment-splits-dialog/`
- `frontend/src/app/shared/utils/cashier-payment-methods.util.ts`
- `frontend/src/app/shared/utils/branch-scope.util.ts`
- `backend/src/modules/settings_module/moneyAccounts.js` (`catalogToPurchaseTreasuryMethods`, account map)
- Purchase/AP dialogs that load `snapshot.purchaseTreasuryMethods` (desk purchase, pay supplier, deferred, installment, invoice return, …)

### Target

1. **One catalog** (`paymentMethodsCatalog` + account map) drives both sale and purchase pickers.
2. **One shared builder** (or thin wrappers) that takes `{ branchId, showIn: 'sale' | 'purchase' | 'both' }` and applies the same branch + linked-account rules.
3. **Prefer one payment UI** where feasible (`PaymentSplitsDialog` or a smaller shared method-picker), instead of copy-pasted ng-select + amount rows.
4. Callers always pass the transaction `branchId`; changing branch clears or rebuilds confirmed splits.
5. Optional later: backend rejects methods not available for the order’s branch (UI is not the only gate).

### Suggested steps

1. Extract shared `buildPaymentMethodsForContext({ branchId, showIn, … })` from `buildCashierPaymentMethods` + purchase filtering.
2. Wire purchase/AP dialogs to that helper (client-side filter first; keep existing submit payloads).
3. Migrate purchase UIs onto shared dialog/picker where UX allows.
4. Retire or fold outliers (`add-order`, `vendor-opening-debit`) onto the catalog.
5. Align API/`purchaseTreasuryMethods` so it is not a second source of truth (derive only, or drop from client in favor of catalog).

### Out of scope for this item

- Treasury deposit/settle account pickers (money accounts, not sale/purchase method catalog).
- Changing settlement methods’ “always all branches” product rule.

### Done when

- Every sale and purchase payment picker uses the same catalog + branch rules.
- Adding or scoping a method in settings shows correctly in both flows without a second code path.

---

## (Add next items below)

<!--
## 2. Title

**Status:** open  
**Why:** …

### Current state
### Target
### Suggested steps
### Done when
-->
