export const  AdminSidebar = [
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


];
export const  Employee = [

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
export const  Cashier = [

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

export const  OperationManager = [

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

];

