import { Component, ElementRef, ViewChild, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

const PRESET_COLORS = ['#111827', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#2563eb', '#7c3aed', '#db2777'];

@Component({
  selector: 'app-rich-text-editor',
  templateUrl: './rich-text-editor.component.html',
  styleUrls: ['./rich-text-editor.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => RichTextEditorComponent),
      multi: true,
    },
  ],
})
export class RichTextEditorComponent implements ControlValueAccessor {
  @ViewChild('editor', { static: true }) editor?: ElementRef<HTMLDivElement>;

  readonly presets = PRESET_COLORS;
  private savedRange: Range | null = null;
  private onChange: (v: string) => void = () => {};
  onTouched: () => void = () => {};
  private lastHtml = '';

  writeValue(value: string | null): void {
    const html = value || '';
    this.lastHtml = html;
    setTimeout(() => {
      const el = this.editor?.nativeElement;
      if (el && el.innerHTML !== html) {
        el.innerHTML = html;
      }
    }, 0);
  }

  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  cmd(command: string): void {
    document.execCommand(command, false);
    this.onInput();
  }

  saveSelection(ev: Event): void {
    ev.preventDefault();
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      this.savedRange = sel.getRangeAt(0).cloneRange();
    }
  }

  applyColor(color: string): void {
    const el = this.editor?.nativeElement;
    if (el) {
      el.focus();
    }
    if (this.savedRange) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(this.savedRange);
    }
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('foreColor', false, color);
    this.onInput();
  }

  onColorInput(ev: Event): void {
    const value = (ev.target as HTMLInputElement)?.value;
    if (value) {
      this.applyColor(value);
    }
  }

  onInput(): void {
    const html = this.editor?.nativeElement.innerHTML ?? '';
    if (html === this.lastHtml) {
      return;
    }
    this.lastHtml = html;
    this.onChange(html);
  }
}
