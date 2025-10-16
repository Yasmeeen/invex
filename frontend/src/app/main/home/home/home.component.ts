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
  isToday: boolean = true;

  

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
    this.productsSerivce.getProductsStats(this.selectedBranch).subscribe(res=> {
      this.productsStats = res
      this.productsChart(this.productsStats)
    })
  }
  getBranches() {
    let params = {
      'page': 1,
     'limit': 1000
    }
  this.branchesServce.getBranchs(params).subscribe((response: any) => {
      this.branches = response.branches
    })
  }

  changeBranch(){
    this.getOrderStatistics();
    this.invoicesChart();
    this.getProductsStats();
    this.ordersChart();
    this.invoicesChart();
    this.categoriesChart();
  }

  getOrderStatistics(){
    const today = new Date();
    this.isToday = 
      [this.fromDate, this.toDate].every(d =>
        new Date(d).toDateString() === today.toDateString()
      );

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
  productsChart(productsStats: any): void {
    Highcharts.chart('products-chart', {
      chart: { type: 'pie' },
      title: { text: '' },
      plotOptions: {
        pie: {
          colors: ['#7dc46f', '#ea379f'], // 🟢 In Stock, 🔴 Out of Stock
          dataLabels: {
            enabled: true,
            format: '{point.name}: {point.y}'
          }
        }
      },
      series: [{
        name: 'Products',
        type: 'pie',
        data: [
          { name: 'In Stock', y: productsStats?.inStock },
          { name: 'Out of Stock', y: productsStats?.outOfStock }
        ]
      }]
    } as Highcharts.Options);
  }
  

// 🛒 Orders
ordersChart(): void {
  this.dashboardService.getOrdersStatusStats(this.selectedBranch).subscribe((res: any) => {
    Highcharts.chart('orders-chart', {
      chart: { type: 'pie' },
      title: { text: '' },
      plotOptions: {
        pie: {
          colors: ['#7dc46f', '#ea379f'], // ✅ Completed = Green, Restored = Red
          dataLabels: {
            enabled: true,
            format: '{point.name}: {point.y}'
          }
        }
      },
      series: [{
        name: 'Orders',
        type: 'pie',
        data: res.stats // [{ name: 'Completed', y: 40 }, { name: 'Restored', y: 10 }]
      }]
    } as Highcharts.Options);
  });
}


// 🧾 Invoices
invoicesChart(): void {
  this.dashboardService.getInvoicesPerMonth(this.selectedBranch).subscribe((res: any) => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    Highcharts.chart('invoices-chart', {
      chart: { type: 'column' },
      title: { text: `Invoices in ${res.year}` },
      xAxis: { categories: months },
      yAxis: { title: { text: 'Number of Invoices' } },
      series: [{
        name: 'Invoices',
        type: 'column',
        data: res.monthlyCounts,
        color: '#6f42c1' // ✅ Green color
      }]
    } as Highcharts.Options);
  });
}


  categoriesChart(): void {
    this.dashboardService.getCategoriesStats(this.selectedBranch).subscribe((res: any) => {
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
          data: totalItems,
          color: '#ff7f0e' // 🟠 Change this to any color you like (e.g. orange)
        }]
      } as Highcharts.Options);
    });
  }
  


}
