import { Globals } from '@core/globals';
import { Component, OnInit, ViewChild } from '@angular/core';
import { AdminSidebar } from '@shared/resources';
import * as Highcharts from 'highcharts';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
  homeLinks: string [] = ['Home','Employees']
  appSidebar = AdminSidebar;

  constructor(
    private globals: Globals
  ) { }


  ngOnInit(): void {
    this.employeeLaunchChart();
    this.payrollLaunchChart();
    this.performanceLaunchChart();

  }

  performanceLaunchChart(): void {
    Highcharts.chart('performance-container', {
      chart: {
        type: 'column',
      },
      title: {
        text: ''
      },
      plotOptions: {
        pie: {
          innerSize: '85%', // This makes it a donut chart
          depth: 40,
          dataLabels: {
            enabled: false,
            format: '<b>{point.name}</b>: {point.percentage:.1f} %',
          },
        },
      },
      series: [
        {
          name: 'performance',
          type: 'column',
          data: [
            { name: 'Active Employees', y: 50 },
            { name: 'Online Employees', y: 10 },
            { name: 'deactivated Employees', y: 10 },
            { name: 'Active Employees', y: 50 },
            { name: 'Online Employees', y: 10 },
            { name: 'deactivated Employees', y: 10 },
            { name: 'Online Employees', y: 10 },
            { name: 'deactivated Employees', y: 10 },
          ],
        },
      ],
    });
  }

  employeeLaunchChart(): void {
    Highcharts.chart('employees-container', {
      chart: {
        type: 'pie',
      },
      title: {
        text: ''
      },
      plotOptions: {
        pie: {
          innerSize: '85%', // This makes it a donut chart
          depth: 40,
          dataLabels: {
            enabled: false,
            format: '<b>{point.name}</b>: {point.percentage:.1f} %',
          },
        },
      },
      series: [
        {
          name: 'Employees',
          type: 'pie',
          data: [
            { name: 'Active Employees', y: 50 },
            { name: 'Online Employees', y: 10 },
            { name: 'deactivated Employees', y: 10 },
          ],
        },
      ],
    });
  }

  payrollLaunchChart(): void {
    Highcharts.chart('payroll-container', {
      chart: {
        type: 'areaspline',
      },
      title: {
        text: ''
      },
      plotOptions: {
        pie: {
          innerSize: '85%', // This makes it a donut chart
          depth: 40,
          dataLabels: {
            enabled: false,
            format: '<b>{point.name}</b>: {point.percentage:.1f} %',
          },
        },
      },
      series: [
        {
          name: 'Payroll',
          type: 'areaspline',
          data: [
            { name: 'Active Employees', y: 50 },
            { name: 'Online Employees', y: 10 },
            { name: 'deactivated Employees', y: 10 },
          ],
        },
      ],
    });
  }



}
