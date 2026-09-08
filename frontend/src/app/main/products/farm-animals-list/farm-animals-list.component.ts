import { Component, OnInit } from '@angular/core';
import { FarmAnimal, Product } from '@core/models/products.model';
import { FarmAnimalsService } from '@shared/services/farm-animals.service';

@Component({
  selector: 'app-farm-animals-list',
  templateUrl: './farm-animals-list.component.html',
  styleUrls: ['./farm-animals-list.component.scss'],
})
export class FarmAnimalsListComponent implements OnInit {
  animals: FarmAnimal[] = [];
  loading = false;
  search = '';
  status = '';

  constructor(private farmAnimalsApi: FarmAnimalsService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.farmAnimalsApi
      .list({
        search: this.search.trim() || undefined,
        status: this.status || undefined,
      })
      .subscribe(
        (response) => {
          this.animals = response?.animals || [];
          this.loading = false;
        },
        () => {
          this.animals = [];
          this.loading = false;
        }
      );
  }

  productName(animal: FarmAnimal): string {
    const product = animal.product as Product;
    return product && typeof product === 'object' ? product.name : '—';
  }

  locationName(animal: FarmAnimal): string {
    if (animal.inWarehouse) return 'tr_warehouse';
    const branch = animal.branch;
    if (branch && typeof branch === 'object') return branch.name || '—';
    const factory = animal.factory;
    if (factory && typeof factory === 'object') return factory.name || '—';
    return '—';
  }
}
