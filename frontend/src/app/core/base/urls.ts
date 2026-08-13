import { environment } from "src/environments/environment";

export const BASE_URL = environment.apiUrl



export const USER_LOGIN_URL = BASE_URL + '/users/login';
export const USER_LOGOUT_URL = BASE_URL + '/users/logout';
export const USER_REGISTER_URL = BASE_URL + '/users/register';
export const USER_UPDATE_PASSWORD_URL = BASE_URL + '/users/updatePassword';

export const USERS_URL = BASE_URL + '/users';
export const USER_CREATE_URL = USERS_URL + '/createUser';
export const USER_UPDATE_URL = USERS_URL;
export const USER_DELETE_URL = USERS_URL;

export const CLIENTS_URL=  BASE_URL +'/clients'

//dashboard
export const ORDER_STATISTICS = BASE_URL + '/dashboard/getOrdersStatstics';



export const PRODUCTS_URL = BASE_URL + '/products';
export const PRODUCT_CREATE_PRODUCT_URL = PRODUCTS_URL+ '/createProduct';
export const PRODUCT_UPDATE_PRODUCT_URL = PRODUCTS_URL ;
export const PRODUCT_DELETE_PRODUCT_URL = PRODUCTS_URL + '/deleteProduct';
export const PRODUCT_STATS =  PRODUCTS_URL +'/getProductsStats'
export const PRODUCTS_IMPORT_METADATA_URL = PRODUCTS_URL + '/import-metadata';
export const PRODUCTS_IMPORT_EXCEL_URL = PRODUCTS_URL + '/import-excel';
export const PRODUCTS_INVENTORY_AUDIT_URL = PRODUCTS_URL + '/inventory-audit';

export const CATEGORYS_URL = BASE_URL + '/categories';
export const CATEGORY_CREATE_CATEGORY_URL = CATEGORYS_URL+ '/createCategory';
export const CATEGORY_UPDATE_CATEGORY_URL = CATEGORYS_URL + '/updateCategory';
export const CATEGORY_DELETE_CATEGORY_URL = CATEGORYS_URL + '/deleteCategory';

export const BRANCHES_URL = BASE_URL + '/branches';
export const BRANCH_CREATE_BRANCH_URL = BRANCHES_URL+ '/createBranch';
export const BRANCH_UPDATE_BRANCH_URL = BRANCHES_URL + '/updateBranch';
export const BRANCH_DELETE_BRANCH_URL = BRANCHES_URL + '/deleteBranch';


export const ORDERS_URL = BASE_URL + '/orders';
export const ORDER_CREATE_URL = ORDERS_URL + '/createOrder';
export const ORDER_UPDATE_URL = ORDERS_URL + '/updateOrder';


export const VENDORS_URL = BASE_URL + '/vendors';

export const PURCHASING_URL = BASE_URL + '/purchasing';

export const ORDER_PAY_URL = ORDERS_URL + '/pay';
export const ORDER_TRACK_URL = ORDERS_URL + '/track/';

export const STORE_SETTINGS_URL = BASE_URL + '/settings/store';
export const UPLOAD_PRODUCT_IMAGE_URL = BASE_URL + '/uploads/product-image';
export const REPORTS_URL = BASE_URL + '/reports';

export const PRODUCT_BOOKINGS_URL = BASE_URL + '/product-bookings';
export const NOTIFICATIONS_URL = BASE_URL + '/notifications';
export const PRODUCT_PURCHASE_REQUESTS_URL = BASE_URL + '/product-purchase-requests';

export const AUDITS_URL = BASE_URL + '/audits';

export const DAILY_EXPENSES_URL = BASE_URL + '/daily-expenses';

export const DRAWER_CLOSE_URL = BASE_URL + '/drawer-close';

export const TREASURY_URL = BASE_URL + '/treasury';
export const MONEY_ACCOUNTS_URL = BASE_URL + '/money-accounts';
export const PAYMENT_METHODS_URL = BASE_URL + '/payment-methods';

// AI assistant (Vixa)
export const AI_CHAT_URL = BASE_URL + '/ai/chat';