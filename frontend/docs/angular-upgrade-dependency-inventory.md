# Angular dependency inventory (12 → current)

Generated for staged major Angular upgrades alongside `ng update` runs.

## Core stack (must move in lockstep with `ng update`)

| Package | Current | Notes |
|---------|---------|--------|
| `@angular/*` | ~12.2 | Bump with `@angular/cli` each major. |
| `@angular/material`, `@angular/cdk` | ^12.2.x | Same major as Angular. Expect SCSS theming mixin changes mid-stream. |
| `@angular-devkit/build-angular` | ~12.2 | Moves with CLI. Later majors may migrate to `application` builder / esbuild. |
| TypeScript | ~4.3.5 | Raised by schematic each major until modern TS required. |
| `zone.js` | ~0.11.4 | Bumped alongside Angular majors. |
| `rxjs` | ^6.x | Migrate to RxJS 7 typical by Angular 15+; codemods / manual fixes. |

## Third-party Angular libraries

| Package | Current | Risk / upgrade path |
|---------|---------|----------------------|
| `@ng-select/ng-select` | ^7.3 | Upgrade per peer deps per Angular major; newer majors need newer `@ng-select`. |
| `@ngx-translate/core` | ^13 | Move to Angular-matching major releases; check changelog for Ivy/standalone notes. |
| `@ngx-translate/http-loader` | ^6 | Keep major aligned with `core` recommendation from maintainers. |
| `@ngx-loading-bar/*` | ^5 | Verify peer Angular range each hop; bump if constrained. |
| `ngx-toastr` | ^18 | Peer range must match Angular; align version after Framework stabilizes at target major. |
| `highcharts-angular` | ^2.4 | Check Highcharts peer table; bump `highcharts` if required. |
| `angular-font-awesome` | ^3.1 | **High risk** — unmaintained pattern; candidates: `@fortawesome/angular-fontawesome`, or FA CSS + `<i>`/SVG. Replace if upgrades block compilation. |

## Non-Angular (usually minor touch)

| Package | Notes |
|---------|--------|
| `moment` | Prefer `date-fns`/`luxon` long-term; not blocking upgrade. |
| `@zxing/*`, `exceljs`, `jspdf`, `xlsx`, `socket.io-client` | Vanilla JS/libs; bump for security as needed after build passes. |

## Environment

| Item | Requirement |
|------|--------------|
| Node | Angular 17+ expects Node 18.19+ / 20+; Angular 13–16 have lower floors — use **Node 20+** (or 22 LTS) during multi-hop migration for consistency with latest target. Do **not** use default NVM `node 8`; use `nvm use 20` (or `.nvmrc`). |
| `NODE_OPTIONS=--openssl-legacy-provider` | Workaround for old webpack/crypto; revisit after toolchain upgrade ([package.json scripts](../package.json)). |

## Deprecation checkpoints (manual after each major)

- Migrate `TestBed.get` → `inject` where flagged.
- Update `providedIn`, constructor DI patterns if strict mode tightens.
- Router / guard functional APIs when schematics prompt.
- Optional later: standalone migration, `@if`/`@for` control flow — **not** required for parity upgrade.
