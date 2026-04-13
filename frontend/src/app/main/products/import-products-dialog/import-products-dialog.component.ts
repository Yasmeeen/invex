import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import * as ExcelJS from 'exceljs';
import { TranslateService } from '@ngx-translate/core';
import {
  ImportExcelRow,
  ProductsImportError,
  ProductsImportMetadata,
  ProductsImportResult,
  ProductsSerivce,
} from '@shared/services/products.service';

type DialogData = {
  metadata: ProductsImportMetadata;
};

@Component({
  selector: 'app-import-products-dialog',
  templateUrl: './import-products-dialog.component.html',
  styleUrls: ['./import-products-dialog.component.scss'],
})
export class ImportProductsDialogComponent {
  allowPartial = true;
  autoComputeNetPrice = true;

  fileName = '';
  parsing = false;
  importing = false;

  parsedRows: ImportExcelRow[] = [];
  parseErrors: ProductsImportError[] = [];

  result: ProductsImportResult | null = null;

  constructor(
    private productsService: ProductsSerivce,
    private dialogRef: MatDialogRef<ImportProductsDialogComponent>,
    private translate: TranslateService,
    @Inject(MAT_DIALOG_DATA) public data: DialogData
  ) {}

  close(): void {
    this.dialogRef.close(this.result);
  }

  downloadTemplate(): void {
    const lang = String(this.translate?.currentLang || this.translate?.defaultLang || 'en').toLowerCase();
    const isAr = lang.startsWith('ar');

    const categories = (this.data?.metadata?.categories || []).slice().sort((a, b) => {
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    });
    const branches = (this.data?.metadata?.branches || []).slice().sort((a, b) => {
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    });

    const attrKeys = new Set<string>();
    const attrLabelByKey = new Map<string, string>();
    for (const c of categories) {
      for (const d of c.attributeDefs || []) {
        const k = String((d as any)?.key || '').trim();
        if (!k) continue;
        attrKeys.add(k);
        const label = String((d as any)?.label || '').trim();
        if (!attrLabelByKey.has(k)) {
          attrLabelByKey.set(k, label || k);
        }
      }
    }
    const attrCols = Array.from(attrKeys)
      .sort()
      .map((k) => ({
        key: k,
        label: attrLabelByKey.get(k) || k,
      }));

    // User-friendly headers (no technical keys shown).
    // Parsing supports these labels via metadata mapping.
    const fixedCols: Array<{ key: string; label: string }> = [
      { key: 'categoryName', label: isAr ? 'الفئة' : 'Category' },
      { key: 'name', label: isAr ? 'الاسم' : 'Name' },
      { key: 'code', label: isAr ? 'الكود' : 'Code' },
      { key: 'price', label: isAr ? 'السعر' : 'Price' },
      { key: 'discount', label: isAr ? 'الخصم' : 'Discount' },
      { key: 'netPrice', label: isAr ? 'صافي السعر' : 'Net Price' },
      { key: 'stock', label: isAr ? 'المخزون' : 'Stock' },
      { key: 'inWarehouse', label: isAr ? 'في المخزن' : 'In Warehouse' },
      { key: 'imageUrl', label: isAr ? 'رابط الصورة' : 'Image URL' },
    ];

    const headers = [
      ...fixedCols.map((c) => c.label),
      ...attrCols.map((c) => c.label),
    ];

    const readmeRows = [
      {
        Field: isAr ? 'الشيتات' : 'Sheets',
        Description: isAr
          ? 'شيت لكل فرع. اسم الشيت لازم يطابق اسم الفرع بالظبط. كل صف = منتج. ممكن كمان تحطي inWarehouse=true عشان يدخل المخزن.'
          : 'One sheet per branch. Sheet name must match Branch name exactly. Each row = one product. You can also set inWarehouse=true to import to warehouse.',
      },
      {
        Field: isAr ? 'مطلوب' : 'Required',
        Description: isAr
          ? 'الفئة، الاسم، السعر، المخزون. الكود/صافي السعر ممكن يسيبوا فاضي (حسب إعدادات الاستيراد).'
          : 'Category, Name, Price, Stock. Code/Net Price can be left empty (import options may generate/compute).',
      },
      {
        Field: isAr ? 'الأعمدة' : 'Headers',
        Description: isAr
          ? 'الأعمدة معمولة لتكون واضحة للمستخدم. يفضّل عدم تغيير أسماء الأعمدة بعد تحميل التيمبليت.'
          : 'Headers are user-friendly. Do not rename columns after downloading the template.',
      },
      {
        Field: isAr ? 'الخصائص' : 'Attributes',
        Description: isAr
          ? 'هتلاقي أعمدة إضافية للخصائص حسب الفئات. امليها لو محتاج. الخصائص غير المعروفة بتتجاهل.'
          : 'You will find extra columns for dynamic attributes. Fill them if needed. Unknown attributes are ignored.',
      },
      {
        Field: isAr ? 'قيم صح/غلط' : 'Booleans',
        Description: isAr
          ? 'عمود "في المخزن" يقبل true/false أو 1/0 أو yes/no.'
          : 'The "In Warehouse" column accepts true/false, 1/0, yes/no.',
      },
    ];
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'INVEX';
    workbook.created = new Date();

    const petroleum = '0F4C5C';
    const headerFill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: petroleum },
    };

    const applyHeaderStyle = (ws: ExcelJS.Worksheet) => {
      const headerRow = ws.getRow(1);
      headerRow.height = 28;
      headerRow.eachCell((cell: ExcelJS.Cell) => {
        cell.font = { bold: true, size: 16, color: { argb: 'FFFFFF' } };
        cell.fill = headerFill;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: '0B3A44' } },
          left: { style: 'thin', color: { argb: '0B3A44' } },
          bottom: { style: 'thin', color: { argb: '0B3A44' } },
          right: { style: 'thin', color: { argb: '0B3A44' } },
        };
      });

      // Auto width based on header text.
      ws.columns = headers.map((h) => {
        const len = String(h || '').length;
        return { header: h, key: h, width: Math.min(60, Math.max(16, len + 6)) };
      });

      ws.views = [{ state: 'frozen', ySplit: 1 }];
    };

    const readme = workbook.addWorksheet('README');
    readme.columns = [
      { header: isAr ? 'العنصر' : 'Field', key: 'Field', width: 22 },
      { header: isAr ? 'الوصف' : 'Description', key: 'Description', width: 90 },
    ];
    readme.addRow([isAr ? 'العنصر' : 'Field', isAr ? 'الوصف' : 'Description']);
    applyHeaderStyle(readme);
    for (const r of readmeRows) {
      readme.addRow([r.Field, r.Description]);
    }
    readme.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

    const branchSheets = branches.length ? branches : [{ _id: 'none', name: 'Branch' }];
    for (const br of branchSheets) {
      const ws = workbook.addWorksheet(String(br.name || 'Branch').slice(0, 31));
      ws.addRow(headers);
      applyHeaderStyle(ws);
      ws.addRow(headers.map(() => ''));
      ws.getRow(2).height = 20;
    }

    workbook.xlsx.writeBuffer().then((buffer: ArrayBuffer) => {
      const filename = `products_import_template_${new Date().toISOString().slice(0, 10)}.xlsx`;
      saveAs(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        filename
      );
    });
  }

  async onFileSelected(file: File | null): Promise<void> {
    this.result = null;
    this.parsedRows = [];
    this.parseErrors = [];
    this.fileName = file?.name || '';

    if (!file) return;

    this.parsing = true;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const rows: ImportExcelRow[] = [];

      const canonicalHeader = (rawKey: any): string => {
        const k = String(rawKey ?? '').trim();
        // Backward compatibility: accept "Label (fieldKey)" if present.
        const m = k.match(/\(([^)]+)\)\s*$/);
        return (m?.[1] || k).trim();
      };

      const norm = (s: string) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

      // Map user-friendly labels to canonical keys.
      const fixedLabelToKey = new Map<string, string>([
        ['category', 'categoryName'],
        ['الفئة', 'categoryName'],
        ['name', 'name'],
        ['الاسم', 'name'],
        ['code', 'code'],
        ['الكود', 'code'],
        ['price', 'price'],
        ['السعر', 'price'],
        ['discount', 'discount'],
        ['الخصم', 'discount'],
        ['net price', 'netPrice'],
        ['صافي السعر', 'netPrice'],
        ['stock', 'stock'],
        ['المخزون', 'stock'],
        ['in warehouse', 'inWarehouse'],
        ['في المخزن', 'inWarehouse'],
        ['image url', 'imageUrl'],
        ['رابط الصورة', 'imageUrl'],
      ]);

      const attrLabelToKey = new Map<string, string>();
      for (const c of this.data?.metadata?.categories || []) {
        for (const d of c.attributeDefs || []) {
          const key = String((d as any)?.key || '').trim();
          const label = String((d as any)?.label || '').trim();
          if (!key) continue;
          attrLabelToKey.set(norm(key), key);
          if (label) {
            // If duplicate labels exist, keep the first mapping.
            if (!attrLabelToKey.has(norm(label))) {
              attrLabelToKey.set(norm(label), key);
            }
          }
        }
      }

      for (const sheetName of wb.SheetNames || []) {
        if (String(sheetName).toUpperCase() === 'README') continue;
        const ws = wb.Sheets[sheetName];
        if (!ws) continue;

        const json = XLSX.utils.sheet_to_json(ws, { defval: '' }) as any[];
        if (!Array.isArray(json) || !json.length) continue;

        json.forEach((r, idx) => {
          const rawObj: any = r || {};
          const obj: any = {};
          // Normalize keys so we can accept both raw keys and "Label (key)" headers.
          for (const [k, v] of Object.entries(rawObj)) {
            const canon = canonicalHeader(k);
            const canonNorm = norm(canon);
            const fixedKey = fixedLabelToKey.get(canonNorm);
            if (fixedKey) {
              obj[fixedKey] = v;
              continue;
            }
            // Accept raw canonical keys too
            if (
              canon === 'categoryName' ||
              canon === 'name' ||
              canon === 'code' ||
              canon === 'price' ||
              canon === 'discount' ||
              canon === 'netPrice' ||
              canon === 'stock' ||
              canon === 'inWarehouse' ||
              canon === 'imageUrl'
            ) {
              obj[canon] = v;
              continue;
            }
            // Attributes: map label/key to attribute key
            const attrKey = attrLabelToKey.get(canonNorm);
            if (attrKey) {
              obj[`attr.${attrKey}`] = v;
              continue;
            }
            // Legacy support: accept headers already like "attr.color"
            if (canonNorm.startsWith('attr.')) {
              obj[canon] = v;
              continue;
            }
          }
          const attributes: Record<string, any> = {};
          for (const [k, v] of Object.entries(obj)) {
            const key = String(k || '').trim();
            if (!key.toLowerCase().startsWith('attr.')) continue;
            const attrKey = key.slice(5).trim();
            if (!attrKey) continue;
            const val = String(v ?? '').trim();
            if (val === '') continue;
            attributes[attrKey] = val;
          }
          rows.push({
            sheetBranchName: String(sheetName || '').trim(),
            categoryName: String(obj.categoryName ?? '').trim(),
            name: String(obj.name ?? '').trim(),
            code: String(obj.code ?? '').trim() || undefined,
            price: obj.price,
            discount: obj.discount,
            netPrice: obj.netPrice,
            stock: obj.stock,
            inWarehouse: obj.inWarehouse,
            imageUrl: String(obj.imageUrl ?? '').trim(),
            attributes,
          });
        });
      }

      this.parsedRows = rows;
      if (!rows.length) {
        this.parseErrors = [
          {
            rowNumber: 0,
            sheetName: '',
            message: 'No rows found (make sure you filled at least one sheet and headers match the template).',
          },
        ];
      }
    } catch (e: any) {
      this.parseErrors = [{ rowNumber: 0, sheetName: '', message: e?.message || 'Failed to read Excel file' }];
    } finally {
      this.parsing = false;
    }
  }

  importNow(): void {
    this.result = null;
    if (!this.parsedRows.length) return;

    this.importing = true;
    this.productsService
      .importProductsFromExcelRows({
        rows: this.parsedRows,
        options: { allowPartial: this.allowPartial, autoComputeNetPrice: this.autoComputeNetPrice },
      })
      .subscribe({
        next: (r) => {
          this.result = r;
          this.importing = false;
        },
        error: (err) => {
          const msg = err?.error?.error || err?.message || 'Import failed';
          this.result = { createdCount: 0, failedCount: this.parsedRows.length, errors: [{ rowNumber: 0, sheetName: '', message: msg }] };
          this.importing = false;
        },
      });
  }

  downloadErrorReport(): void {
    const errors = this.result?.errors || [];
    if (!errors.length) return;
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(
      errors.map((e) => ({
        sheetName: e.sheetName,
        rowNumber: e.rowNumber,
        field: e.field || '',
        code: e.code || '',
        message: e.message,
      }))
    );
    XLSX.utils.book_append_sheet(wb, ws, 'Errors');
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const filename = `products_import_errors_${new Date().toISOString().slice(0, 10)}.xlsx`;
    saveAs(new Blob([buffer], { type: 'application/octet-stream' }), filename);
  }
}

