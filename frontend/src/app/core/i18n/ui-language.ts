import { TranslateService } from '@ngx-translate/core';

/** Must match available files under `assets/i18n/*.json` and receipt langs where relevant. */
const SUPPORTED_UI_LANGS = ['ar', 'en', 'de', 'fr'] as const;

function isSupported(code: string | null | undefined): code is (typeof SUPPORTED_UI_LANGS)[number] {
  return !!code && (SUPPORTED_UI_LANGS as readonly string[]).includes(code);
}

function loggedInUserLocale(): string | null {
  try {
    const raw = localStorage.getItem('currentUser');
    if (!raw) {
      return null;
    }
    const u = JSON.parse(raw);
    const loc = u?.locale;
    if (typeof loc === 'string' && isSupported(loc.trim().toLowerCase())) {
      return loc.trim().toLowerCase();
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Resolves UI language: explicit preference → stored user locale → (guests only) browser → English.
 * Logged-in users never fall back to browser language — avoids German/French flashes on refresh.
 */
export function resolveUiLanguageCode(translate: TranslateService, preferred?: string | null): string {
  const p = preferred?.trim().toLowerCase();
  if (isSupported(p)) {
    return p;
  }
  const stored = loggedInUserLocale();
  if (stored) {
    return stored;
  }
  if (localStorage.getItem('currentUser')) {
    return 'en';
  }
  const browser = translate.getBrowserLang()?.split('-')[0]?.toLowerCase();
  if (isSupported(browser)) {
    return browser;
  }
  return 'en';
}

/**
 * Single entry point: sets `dir` on body and `TranslateService.use(lang)` without conflicting defaults.
 */
export function applyUiLanguage(translate: TranslateService, preferred?: string | null): void {
  const lang = resolveUiLanguageCode(translate, preferred);
  document.querySelector('body')?.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  translate.use(lang);
}
