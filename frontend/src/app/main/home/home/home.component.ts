import { ProductsSerivce } from './../../../shared/services/products.service';
import { Component, OnInit } from '@angular/core';
import * as Highcharts from 'highcharts';
import HC_treemap from 'highcharts/modules/treemap';
import HC_solidGauge from 'highcharts/modules/solid-gauge';
import { DashboardService } from '@shared/services/dashboard.service';
import { orderStatistics } from '@core/models/dashboard.model';
import { Branch } from '@core/models/products.model';
import { BranchesServce } from '@shared/services/branches.service';

// ✅ Initialize extra modules
HC_treemap(Highcharts);
HC_solidGauge(Highcharts);

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {

  fromDate: Date = new Date();
  toDate: Date = new Date();
  selectedBranch: any;
  branches: Branch [] = [];

  totalInvoices = 280;
  totalCategories = 25;
  orderStatistics: orderStatistics;
  productsStats:any;
  constructor(
    private dashboardService: DashboardService,
    private productsSerivce: ProductsSerivce,
    private branchesServce: BranchesServce
  ) { }

  ngOnInit(): void {
    this.getOrderStatistics();
    this.getProductsStats();
    this.getBranches();
    this.ordersChart();
    this.invoicesChart();
    this.categoriesChart();

  }

  getProductsStats(){
    let params = {}
    this.productsSerivce.getProductsStats(params).subscribe(res=> {
      this.productsStats = res
      this.productsChart(this.productsStats)
    })
  }
  getBranches() {
    let params = {
      'page': 1,
     'per_page': 1000
    }
  this.branchesServce.getBranchs(params).subscribe((response: any) => {
      this.branches = response.branches
    })
  }

  changeBranch(){
    this.getOrderStatistics();
  }

  getOrderStatistics(){

    let params ={
      from: this.fromDate.toLocaleDateString('en-CA'),
      to: this.toDate.toLocaleDateString('en-CA'),
      branch: this.selectedBranch
    }

    this.dashboardService.getDashboardStats(params).subscribe(res=> {
      this.orderStatistics = res;  
    })
  }





  // 📦 Products
  productsChart(productsStats:any): void {
    console.log("productsStats",productsStats);
    
    Highcharts.chart('products-chart', {
      chart: { type: 'pie' },
      title: { text: '' },
      series: [{
        name: 'Products',
        type: 'pie',
        data: [
          { name: 'In Stock', y: productsStats?.inStock },
          { name: 'Out of Stock', y: productsStats?.outOfStock  }
        ]
      }]
    } as Highcharts.Options);
  }

  // 🛒 Orders
  ordersChart(): void {
    this.dashboardService.getOrdersStatusStats().subscribe((res: any) => {
      Highcharts.chart('orders-chart', {
        chart: { type: 'pie' },
        title: { text: '' },
        series: [{
          name: 'Orders',
          type: 'pie',
          data: res.stats  // dynamically loaded data
        }]
      } as Highcharts.Options);
    });
  }

  // 🧾 Invoices
  invoicesChart(): void {
    this.dashboardService.getInvoicesPerMonth().subscribe((res: any) => {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      
      Highcharts.chart('invoices-chart', {
        chart: { type: 'column' },
        title: { text: `Invoices in ${res.year}` },
        xAxis: { categories: months },
        yAxis: { title: { text: 'Number of Invoices' } },
        series: [{
          name: 'Invoices',
          type: 'column',
          data: res.monthlyCounts
        }]
      } as Highcharts.Options);
    });

  }

  // 🏷️ Categories
  categoriesChart(): void {
    this.dashboardService.getCategoriesStats().subscribe((res: any) => {
      const categories = res.stats.map((c: any) => c.categoryName);
      const totalItems = res.stats.map((c: any) => c.totalItems);
    
      Highcharts.chart('categories-chart', {
        chart: { type: 'bar' },
        title: { text: 'Items per Category' },
        xAxis: { categories },
        yAxis: { title: { text: 'Total Items' } },
        series: [{
          name: 'Total Items',
          type: 'bar',
          data: totalItems
        }]
      } as Highcharts.Options);
    });


  }

 

  // 🔗 Click actions
  openUsersDetails() { console.log('Open Users details modal'); }
  openProductsDetails() { console.log('Open Products details modal'); }
  openOrdersDetails() { console.log('Open Orders details modal'); }
  openInvoicesDetails() { console.log('Open Invoices details modal'); }
  openCategoriesDetails() { console.log('Open Categories details modal'); }
  openInventoryDetails() { console.log('Open Inventory details modal'); }
}
