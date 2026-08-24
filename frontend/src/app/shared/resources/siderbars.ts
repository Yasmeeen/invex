export const AdminSidebar = [
  {
    name: 'tr_dashboard',
    routerLink: '/home',
    icon: 'fa fa-tachometer icon',
  },
  {
    name: 'tr_sidebar_inventory_products',
    routerLink: 'null',
    icon: 'fa fa-cubes icon',
    children: [
      {
        name: 'tr_products',
        routerLink: '/products',
        icon: 'fa fa-cube icon',
      },
      {
        name: 'tr_price_list',
        routerLink: '/products/price-list',
        icon: 'fa fa-list icon',
      },
      {
        name: 'tr_inventory',
        routerLink: '/inventory',
        icon: 'fa fa-cubes icon',
      },
      {
        name: 'tr_serial_track',
        routerLink: '/products/serial-track',
        icon: 'fa fa-barcode icon',
      },
      {
        name: 'tr_branch_transfers_pending',
        routerLink: '/products/branch-transfers',
        icon: 'fa fa-exchange icon',
      },
      {
        name: 'tr_categories',
        routerLink: '/categories',
        icon: 'fa fa-tags icon',
      },
    ],
  },
  {
    name: 'tr_sidebar_sales_cashier',
    routerLink: 'null',
    icon: 'fa fa-credit-card icon',
    children: [
      {
        name: 'tr_cashier.TITLE',
        routerLink: '/cashier',
        icon: 'fa fa-credit-card icon',
      },
      {
        name: 'tr_orders',
        routerLink: '/orders',
        icon: 'fa fa-list-alt icon',
      },
      {
        name: 'tr_daily_expenses_menu',
        routerLink: '/expenses',
        icon: 'fa fa-money icon',
      },
      {
        name: 'tr_drawer_close_history_menu',
        routerLink: '/drawer-close',
        icon: 'fa fa-inbox icon',
      },
    ],
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
        name: 'tr_due_installments_title',
        routerLink: '/collections/due',
        icon: 'fa fa-calendar-check-o icon',
      },
      {
        name: 'tr_purchases',
        routerLink: '/purchasing',
        icon: 'fa fa-file-text-o icon',
      },
    ],
  },
  {
    name: 'tr_treasury_menu',
    routerLink: 'null',
    icon: 'fa fa-university icon',
    children: [
      {
        name: 'tr_money_accounts_settings_title',
        routerLink: '/treasury/config/treasuries',
        icon: 'fa fa-university icon',
      },
      {
        name: 'tr_payment_methods_catalog_title',
        routerLink: '/treasury/config/payment-methods',
        icon: 'fa fa-credit-card icon',
      },
    ],
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
      {
        name: 'tr_report_title_desk_purchases',
        routerLink: '/reports/desk-purchases',
        icon: 'fa fa-shopping-basket icon',
      },
      {
        name: 'tr_reports_treasury',
        routerLink: '/reports/treasury',
        icon: 'fa fa-university icon',
      },
    ],
  },
  {
    name: 'tr_sidebar_administration',
    routerLink: 'null',
    icon: 'fa fa-cogs icon',
    children: [
      {
        name: 'tr_permissions_title',
        routerLink: '/settings/permissions',
        icon: 'fa fa-lock icon',
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
        name: 'tr_store_settings_menu',
        routerLink: '/settings',
        icon: 'fa fa-wrench icon',
      },
      {
        name: 'tr_installment_plans_title',
        routerLink: '/settings/installment-plans',
        icon: 'fa fa-calendar icon',
      },
      {
        name: 'tr_audit_title',
        routerLink: '/audits',
        icon: 'fa fa-history icon',
      },
    ],
  },
  {
    name: 'tr_vixa',
    routerLink: '/vixa',
    icon: 'fa fa-comments icon',
  },
  {
    name: 'tr_faq',
    routerLink: '/faq',
    icon: 'fa fa-question-circle icon',
  },
];

/** Co Admin: full admin menu except dashboard (/home) and profit report.
 *  Accounts dashboard is not on /home for this role, so /treasury stays in the menu.
 */
export const CoAdminSidebar = AdminSidebar.filter((item) => item.routerLink !== '/home').map(
  (item) => {
    if (!item.children?.length) {
      return item;
    }
    const children = item.children.filter(
      (c) => c.routerLink !== '/reports/profit' && c.routerLink !== '/settings/permissions'
    );
    if (item.name === 'tr_treasury_menu') {
      return {
        ...item,
        children: [
          {
            name: 'tr_treasury_balances',
            routerLink: '/treasury',
            icon: 'fa fa-list-alt icon',
          },
          ...children,
        ],
      };
    }
    return { ...item, children };
  }
);

/** Branch Manager: like Co Admin but no administration group.
 *  Treasury config (accounts / payment methods) is admin-only.
 *  Accounts dashboard lives on /home (admin); no separate /treasury menu entry.
 */
export const BranchManagerSidebar = CoAdminSidebar.filter(
  (item) =>
    item.name !== 'tr_sidebar_administration' && item.name !== 'tr_treasury_menu'
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
  {
    name: 'tr_daily_expenses_menu',
    routerLink: '/expenses',
    icon: 'fa fa-money icon',
  },
  {
    name: 'tr_drawer_close_history_menu',
    routerLink: '/drawer-close',
    icon: 'fa fa-inbox icon',
  },
  {
    name: 'tr_faq',
    routerLink: '/faq',
    icon: 'fa fa-question-circle icon',
  },
];

/** Collector: follow-up installment collections for assigned clients. */
export const CollectorSidebar = [
  {
    name: 'tr_due_installments_title',
    routerLink: '/collections/due',
    icon: 'fa fa-calendar-check-o icon',
  },
  {
    name: 'tr_clients',
    routerLink: '/clients',
    icon: 'fa fa-user-circle-o icon',
  },
  {
    name: 'tr_orders',
    routerLink: '/orders',
    icon: 'fa fa-list-alt icon',
  },
  {
    name: 'tr_vixa',
    routerLink: '/vixa',
    icon: 'fa fa-comments icon',
  },
  {
    name: 'tr_faq',
    routerLink: '/faq',
    icon: 'fa fa-question-circle icon',
  },
];

/** Formerly Operation Manager — orders, inventory, products, branches, categories, stock report only. */
export const Warehouse = [
  {
    name: 'tr_sidebar_inventory_products',
    routerLink: 'null',
    icon: 'fa fa-cubes icon',
    children: [
      {
        name: 'tr_products',
        routerLink: '/products',
        icon: 'fa fa-cube icon',
      },
      {
        name: 'tr_price_list',
        routerLink: '/products/price-list',
        icon: 'fa fa-list icon',
      },
      {
        name: 'tr_inventory',
        routerLink: '/inventory',
        icon: 'fa fa-cubes icon',
      },
      {
        name: 'tr_serial_track',
        routerLink: '/products/serial-track',
        icon: 'fa fa-barcode icon',
      },
      {
        name: 'tr_categories',
        routerLink: '/categories',
        icon: 'fa fa-tags icon',
      },
    ],
  },
  {
    name: 'tr_orders',
    routerLink: '/orders',
    icon: 'fa fa-list-alt icon',
  },
  {
    name: 'tr_branches',
    routerLink: '/branches',
    icon: 'fa fa-building icon',
  },
  {
    name: 'tr_reports',
    routerLink: 'null',
    icon: 'fa fa-bar-chart icon',
    children: [
      { name: 'tr_reports_stock', routerLink: '/reports/stock', icon: 'fa fa-exchange icon' },
    ],
  },
  {
    name: 'tr_vixa',
    routerLink: '/vixa',
    icon: 'fa fa-comments icon',
  },
  {
    name: 'tr_faq',
    routerLink: '/faq',
    icon: 'fa fa-question-circle icon',
  },
];

/** View products only; bookings allowed from products list. */
export const ModeratorSidebar = [
  {
    name: 'tr_products',
    routerLink: '/products',
    icon: 'fa fa-cube icon',
  },
  {
    name: 'tr_price_list',
    routerLink: '/products/price-list',
    icon: 'fa fa-list icon',
  },
  {
    name: 'tr_faq',
    routerLink: '/faq',
    icon: 'fa fa-question-circle icon',
  },
];

/** @deprecated Use Warehouse */
export const OperationManager = Warehouse;
