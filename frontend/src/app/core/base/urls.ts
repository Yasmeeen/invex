import { environment } from "src/environments/environment";

export const BASE_URL = environment.production? '' : 'http://localhost:3000';


export const USER_LOGIN_URL = BASE_URL + '/api/users/login';
export const USER_REGISTER_URL = BASE_URL + '/api/users/register';
export const USER_UPDATE_PASSWORD_URL = BASE_URL + '/api/users/updatePassword';

export const USERS_URL = BASE_URL + '/api/users';
export const USER_CREATE_URL = USERS_URL;
export const USER_UPDATE_URL = USERS_URL;
export const USER_DELETE_URL = USERS_URL;


export const PRODUCTS_URL = BASE_URL + '/api/products';
export const PRODUCT_CREATE_PRODUCT_URL = PRODUCTS_URL+ '/createProduct';
export const PRODUCT_UPDATE_PRODUCT_URL = PRODUCTS_URL ;
export const PRODUCT_DELETE_PRODUCT_URL = PRODUCTS_URL + '/deleteProduct';

export const CATEGORYS_URL = BASE_URL + '/api/categories';
export const CATEGORY_CREATE_CATEGORY_URL = CATEGORYS_URL+ '/createCategory';
export const CATEGORY_UPDATE_CATEGORY_URL = CATEGORYS_URL + '/updateCategory';
export const CATEGORY_DELETE_CATEGORY_URL = CATEGORYS_URL + '/deleteCategory';

export const BRANCHES_URL = BASE_URL + '/api/branches';
export const BRANCH_CREATE_BRANCH_URL = BRANCHES_URL+ '/createBranch';
export const BRANCH_UPDATE_BRANCH_URL = BRANCHES_URL + '/updateBranch';
export const BRANCH_DELETE_BRANCH_URL = BRANCHES_URL + '/deleteBranch';


export const ORDERS_URL = BASE_URL + '/api/orders';
export const ORDER_CREATE_URL = ORDERS_URL + '/create';
export const ORDER_UPDATE_URL = ORDERS_URL + '/updateOrder';

export const ORDER_PAY_URL = ORDERS_URL + '/pay';
export const ORDER_TRACK_URL = ORDERS_URL + '/track/';
