export const AdminSidebar = [
  {
    name: 'tr_dashboard',
    routerLink: '/home',
    icon: 'fa fa-tachometer icon',
  },
  {
    name: 'tr_products',
    routerLink: '/products',
    icon: 'fa fa-cube icon',
  },
  {
    name: 'tr_inventory',
    routerLink: '/inventory',
    icon: 'fa fa-cubes icon',
  },
  {
    name: 'tr_users',
    routerLink: '/users',
    icon: 'fa fa-users icon',
  },
  {
    name: 'tr_branches',
    routerLink: '/branches',
    icon: 'fa fa-building icon',
  },
  {
    name: 'tr_categories',
    routerLink: '/categories',
    icon: 'fa fa-tags icon',
  },
  {
    name: 'tr_store_settings_menu',
    routerLink: '/settings',
    icon: 'fa fa-wrench icon',
  },
  {
    name: 'tr_cashier.TITLE',
    routerLink: '/cashier',
    icon: 'fa fa-credit-card icon',
  },

  {
    name: 'tr_purchases',
    routerLink: 'null',
    icon: 'fa fa-shopping-cart icon orange-icon',
    children: [
      {
        name: 'tr_suppliers',
        routerLink: '/suppliers',
        icon: 'fa fa-truck icon',
      },
      {
        name: 'tr_clients',
        routerLink: '/clients',
        icon: 'fa fa-user-circle-o icon',
      },
      {
        name: 'tr_purchases',
        routerLink: '/purchasing',
        icon: 'fa fa-file-text-o icon',
      }
    ]
  },
  {
    name: 'tr_orders',
    routerLink: '/orders',
    icon: 'fa fa-list-alt icon',
  },
  {
    name: 'tr_reports',
    routerLink: 'null',
    icon: 'fa fa-bar-chart icon',
    children: [
      { name: 'tr_reports_sales', routerLink: '/reports/sales', icon: 'fa fa-line-chart icon' },
      { name: 'tr_reports_profit', routerLink: '/reports/profit', icon: 'fa fa-area-chart icon' },
      { name: 'tr_reports_products', routerLink: '/reports/products', icon: 'fa fa-cube icon' },
      { name: 'tr_reports_stock', routerLink: '/reports/stock', icon: 'fa fa-exchange icon' },
      { name: 'tr_reports_customers', routerLink: '/reports/customers', icon: 'fa fa-users icon' },
      { name: 'tr_reports_installments', routerLink: '/reports/installments', icon: 'fa fa-calendar icon' },
      { name: 'tr_reports_bookings', routerLink: '/reports/bookings', icon: 'fa fa-bookmark icon' },
    ],
  },

  {
    name: 'tr_audit_title',
    routerLink: '/audits',
    icon: 'fa fa-history icon',
  },


];

/** Co Admin: full admin menu except dashboard (/home) and profit report. */
export const CoAdminSidebar = AdminSidebar.filter((item) => item.routerLink !== '/home').map(
  (item) => {
    if (!item.children?.length) {
      return item;
    }
    return {
      ...item,
      children: item.children.filter((c) => c.routerLink !== '/reports/profit'),
    };
  }
);

/** Branch Manager: like Co Admin but no branches, settings, or users. */
export const BranchManagerSidebar = CoAdminSidebar.filter(
  (item) =>
    item.routerLink !== '/branches' &&
    item.routerLink !== '/settings' &&
    item.routerLink !== '/users'
);

export const Cashier = [

  {
    name: 'tr_orders',
    routerLink: '/orders',
    icon: 'fa fa-list-alt icon',
  },
  {
    name: 'tr_cashier.TITLE',
    routerLink: '/cashier',
    icon: 'fa fa-credit-card icon',
  },

];

/** Formerly Operation Manager — orders, inventory, products, branches, categories, reports. */
export const Warehouse = [

  {
    name: 'tr_orders',
    routerLink: '/orders',
    icon: 'fa fa-list-alt icon',
  },
  {
    name: 'tr_inventory',
    routerLink: '/inventory',
    icon: 'fa fa-cubes icon',
  },
  {
    name: 'tr_products',
    routerLink: '/products',
    icon: 'fa fa-cube icon',
  },
  {
    name: 'tr_branches',
    routerLink: '/branches',
    icon: 'fa fa-building icon',
  },
  {
    name: 'tr_categories',
    routerLink: '/categories',
    icon: 'fa fa-tags icon',
  },
  {
    name: 'tr_reports',
    routerLink: 'null',
    icon: 'fa fa-bar-chart icon',
    children: [
      { name: 'tr_reports_sales', routerLink: '/reports/sales', icon: 'fa fa-line-chart icon' },
      { name: 'tr_reports_profit', routerLink: '/reports/profit', icon: 'fa fa-area-chart icon' },
      { name: 'tr_reports_products', routerLink: '/reports/products', icon: 'fa fa-cube icon' },
      { name: 'tr_reports_stock', routerLink: '/reports/stock', icon: 'fa fa-exchange icon' },
      { name: 'tr_reports_customers', routerLink: '/reports/customers', icon: 'fa fa-users icon' },
      { name: 'tr_reports_installments', routerLink: '/reports/installments', icon: 'fa fa-calendar icon' },
      { name: 'tr_reports_bookings', routerLink: '/reports/bookings', icon: 'fa fa-bookmark icon' },
    ],
  },

];

/** View products only; bookings allowed from products list. */
export const ModeratorSidebar = [
  {
    name: 'tr_products',
    routerLink: '/products',
    icon: 'fa fa-cube icon',
  },
];

/** @deprecated Use Warehouse */
export const OperationManager = Warehouse;
