import { Pipe, PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { RECEIPT_LANGUAGE_CODES } from '@shared/services/store-settings.service';

/** impure: re-run when translation packs load async or UI lang changes; avoids stale EN fallback. */
@Pipe({ name: 'receiptTranslate', pure: false })
export class ReceiptTranslatePipe implements PipeTransform {
  constructor(private translate: TranslateService) {}

  transform(key: string, lang: string | null | undefined): string {
    if (!key) {
      return '';
    }
    const code =
      lang && RECEIPT_LANGUAGE_CODES.includes(lang as (typeof RECEIPT_LANGUAGE_CODES)[number])
        ? lang
        : 'en';

    const pack = this.translate.translations[code];
    if (pack) {
      const res = this.translate.getParsedResult(pack, key);
      if (res != null && res !== key) {
        return res as string;
      }
    }

    const enPack = this.translate.translations['en'];
    if (enPack && code !== 'en') {
      const res = this.translate.getParsedResult(enPack, key);
      if (res != null && res !== key) {
        return res as string;
      }
    }

    return this.translate.instant(key);
  }
}
