import { Component, OnDestroy, OnInit } from '@angular/core';
import { AuthenticationService } from '@core/services/authentication.service';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { startWith, switchMap } from 'rxjs/operators';
import { FaqCategory, FaqFlatItem } from '../faq.models';
import { FaqService } from '../faq.service';

@Component({
  selector: 'app-faq-page',
  templateUrl: './faq-page.component.html',
  styleUrls: ['./faq-page.component.scss'],
})
export class FaqPageComponent implements OnInit, OnDestroy {
  categories: FaqCategory[] = [];
  results: FaqFlatItem[] = [];
  searchQuery = '';
  selectedCategoryId: string | null = null;
  openId: string | null = null;
  loading = true;
  loadFailed = false;

  private subs = new Subscription();

  constructor(
    private faqService: FaqService,
    private translate: TranslateService,
    private auth: AuthenticationService
  ) {}

  ngOnInit(): void {
    this.subs.add(
      this.translate.onLangChange.pipe(
        startWith({ lang: this.translate.currentLang || this.translate.defaultLang || 'en' }),
        switchMap((e: { lang: string }) => {
          this.loading = true;
          this.loadFailed = false;
          return this.faqService.load(e.lang);
        })
      ).subscribe(
        (file) => {
          const role = this.auth.currentUser?.role as string | undefined;
          this.categories = this.faqService.visibleCategories(file, role);
          if (
            this.selectedCategoryId &&
            !this.categories.some((c) => c.id === this.selectedCategoryId)
          ) {
            this.selectedCategoryId = null;
          }
          this.applyFilter();
          this.loading = false;
        },
        () => {
          this.categories = [];
          this.results = [];
          this.loading = false;
          this.loadFailed = true;
        }
      )
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  selectCategory(id: string | null): void {
    this.selectedCategoryId = id;
    this.applyFilter();
  }

  onSearchChange(): void {
    this.applyFilter();
  }

  toggle(id: string): void {
    this.openId = this.openId === id ? null : id;
  }

  isOpen(id: string): boolean {
    return this.openId === id;
  }

  private applyFilter(): void {
    this.results = this.faqService.search(
      this.categories,
      this.searchQuery,
      this.selectedCategoryId
    );
  }
}
