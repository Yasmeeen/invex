# Angular dependency inventory — completed upgrade

## Result

| Item | Before | After |
|------|--------|--------|
| `@angular/core` | ~12.2 | **21.2.x** |
| TypeScript | ~4.3 | **5.9** |
| RxJS | 6 | **7.8** |
| zone.js | ~0.11 | **0.15** |
| Node (local) | 8 default | **22** ([`.nvmrc`](../.nvmrc)) |

Production build verified: `ng build --configuration production`.

## Third-party versions aligned

| Package | Version (approx.) |
|---------|-------------------|
| `@angular/material` / `@angular/cdk` | **16.2.14** (legacy MDC migration pending) |
| `@ng-select/ng-select` | 14 |
| `ngx-toastr` | 19 |
| `@ngx-translate/core` / `http-loader` | 16 |
| `@ngx-loading-bar/*` | 6 |
| `highcharts` / `highcharts-angular` | 11 / 4 |

## Code fixes during upgrade

- `ModuleWithProviders<CoreModule>` import from `@angular/core` (was `@angular/compiler/src/core`).
- `window.location.reload()` without deprecated `forceReload` argument.
- Route/guard migrations (functional guards, Material MDC prep).
- `@for` track expressions: single-arg `trackByIndex(i)`.
- `HostListener` signatures for Angular 21 (`Event` vs optional `KeyboardEvent`).
- Removed obsolete `enableIvy: false` from `tsconfig.json`.

## Deprecation / follow-up

1. Run **Material MDC migration** when ready: `ng generate @angular/material:mdc-migration`, then bump `@angular/material` and `@angular/cdk` to 21.
2. Optional: `ng update @angular/cli --name use-application-builder` (esbuild application builder).
3. Replace **angular-font-awesome** when convenient.

See [angular-upgrade-smoke-test.md](./angular-upgrade-smoke-test.md) for manual regression steps.
