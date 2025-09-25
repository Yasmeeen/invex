import { Component, OnInit } from '@angular/core';
import * as Highcharts from 'highcharts';
import HC_treemap from 'highcharts/modules/treemap';
import HC_solidGauge from 'highcharts/modules/solid-gauge';

// ✅ Initialize extra modules
HC_treemap(Highcharts);
HC_solidGauge(Highcharts);

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
  totalUsers = 1200;
  totalProducts = 540;
  totalOrders = 320;
  totalInvoices = 280;
  totalCategories = 25;

  ngOnInit(): void {
    this.usersChart();
    this.productsChart();
    this.ordersChart();
    this.invoicesChart();
    this.categoriesChart();
    // this.inventoryChart();
    this.clientsChart();
  }

  // 🧑‍🤝‍🧑 Users
  usersChart(): void {
    Highcharts.chart('users-chart', {
      chart: { type: 'pie' },
      title: { text: '' },
      series: [{
        name: 'Users',
        type: 'pie',
        data: [
          { name: 'Active', y: 950 },
          { name: 'Inactive', y: 250 }
        ]
      }]
    } as Highcharts.Options);
  }

  // 📦 Products
  productsChart(): void {
    Highcharts.chart('products-chart', {
      chart: { type: 'pie' },
      title: { text: '' },
      series: [{
        name: 'Products',
        type: 'pie',
        data: [
          { name: 'In Stock', y: 400 },
          { name: 'Out of Stock', y: 140 }
        ]
      }]
    } as Highcharts.Options);
  }

  // 🛒 Orders
  ordersChart(): void {
    Highcharts.chart('orders-chart', {
      chart: { type: 'pie' },
      title: { text: '' },
      series: [{
        name: 'Orders',
        type: 'pie',
        data: [
          { name: 'Pending', y: 80 },
          { name: 'Completed', y: 200 },
          { name: 'Cancelled', y: 40 }
        ]
      }]
    } as Highcharts.Options);
  }

  // 🧾 Invoices
  invoicesChart(): void {
    Highcharts.chart('invoices-chart', {
      chart: { type: 'column' },
      title: { text: '' },
      xAxis: { categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May'] },
      series: [{
        name: 'Invoices',
        type: 'column',
        data: [40, 60, 80, 55, 90]
      }]
    } as Highcharts.Options);
  }

  // 🏷️ Categories
  categoriesChart(): void {
    Highcharts.chart('categories-chart', {
      chart: { type: 'bar' },
      title: { text: '' },
      xAxis: { categories: ['Electronics', 'Clothes', 'Food', 'Books', 'Other'] },
      series: [{
        name: 'Products',
        type: 'bar',
        data: [120, 200, 100, 80, 40]
      }]
    } as Highcharts.Options);
  }

  // 📦 Inventory — (Treemap example)
  // inventoryChart(): void {
  //   Highcharts.chart('inventory-chart', {
  //     chart: { type: 'treemap' },
  //     title: { text: 'Inventory Status' },
  //     series: [{
  //       type: 'treemap',
  //       layoutAlgorithm: 'squarified',
  //       data: [
  //         { name: 'Laptops', value: 6, color: '#7cb5ec' },
  //         { name: 'Phones', value: 3, color: '#90ed7d' },
  //         { name: 'Accessories', value: 2, color: '#f7a35c' }
  //       ]
  //     }]
  //   } as Highcharts.Options);
  // }


  // 🧑 Clients — (Solid Gauge example)
  clientsChart(): void {
    Highcharts.chart('clients-chart', {
      chart: { type: 'solidgauge' },
      title: { text: 'Client Satisfaction' },
      pane: {
        center: ['50%', '85%'],
        size: '140%',
        startAngle: -90,
        endAngle: 90,
        background: [{
          backgroundColor: '#EEE',
          innerRadius: '60%',
          outerRadius: '100%',
          shape: 'arc'
        } as any]
      },
      yAxis: {
        min: 0,
        max: 100,
        stops: [[0.1, '#DF5353'], [0.5, '#DDDF0D'], [0.9, '#55BF3B']],
        lineWidth: 0,
        tickWidth: 0,
        labels: { y: 16 }
      },
      series: [{
        name: 'Satisfaction',
        type: 'solidgauge',
        data: [80]
      }]
    } as Highcharts.Options);
  }

  // 🔗 Click actions
  openUsersDetails() { console.log('Open Users details modal'); }
  openProductsDetails() { console.log('Open Products details modal'); }
  openOrdersDetails() { console.log('Open Orders details modal'); }
  openInvoicesDetails() { console.log('Open Invoices details modal'); }
  openCategoriesDetails() { console.log('Open Categories details modal'); }
  openInventoryDetails() { console.log('Open Inventory details modal'); }
}
