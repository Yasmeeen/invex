export interface FaqItem {
  id: string;
  q: string;
  a: string;
  tags?: string[];
  roles?: string[];
}

export interface FaqCategory {
  id: string;
  title: string;
  roles: string[];
  items: FaqItem[];
}

export interface FaqFile {
  categories: FaqCategory[];
}

export interface FaqFlatItem {
  categoryId: string;
  categoryTitle: string;
  item: FaqItem;
}
