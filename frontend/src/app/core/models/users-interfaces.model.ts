import { Branch } from "./products.model";

export interface PaginationData {
  currentPage: number;
  nextPage: number;
  prevPage: number;
  totalCount: number;
  totalPages: number
}

export class User{
  _id:string;
  email?:string;
  name?:string;
  token?:string;
  role?: number;
  password?: string;
  created_at: string;
  local: string;
  branch?: Branch;
}
export class Client{
  _id:string;
  name?:string;
  phoneNumber: string;
  address?:string;
  numberOfOrders: number;
  totalOrdersPrice: number;
  created_at: string;
  branches?: Branch[];
}

export interface ClientHistoryOrderRow {
  _id?: string;
  orderNumber?: number;
  totalPrice?: number;
  amountPaid?: number;
  paymentMethod?: string;
  paymentStatus?: 'unpaid' | 'partial' | 'paid';
  status?: string;
  createdAt?: string;
  sellerName?: string;
  branch?: { _id?: string; name?: string };
  remaining?: number;
  pointsEarned?: number;
  isPayLater?: boolean;
}

export interface ClientHistoryPurchaseRow {
  _id?: string;
  status?: 'pending' | 'approved' | 'rejected';
  createdAt?: string;
  branch?: { _id?: string; name?: string };
  productName?: string;
  productCode?: string;
  quantity?: number;
  unitNetPrice?: number;
  lineTotal?: number;
  totalPaid?: number;
  remaining?: number;
  isDeferredPurchase?: boolean;
  purchaseTreasuryKey?: string;
  purchaseTreasuryLabel?: string;
  createdByName?: string;
}

export interface ClientHistoryResponse {
  client: Pick<Client, '_id' | 'name' | 'phoneNumber' | 'address'>;
  totalPointsEarned: number;
  creditBalanceDue: number;
  creditOrdersCount: number;
  orders: ClientHistoryOrderRow[];
  creditOrders: ClientHistoryOrderRow[];
  purchases?: ClientHistoryPurchaseRow[];
  purchasesCount?: number;
}
export class Employee extends User {


}

export interface IUserLogin{
  id?: string,
  email?:string;
  password:string;
  confirmPassword?: string
}
export class UserDetailsLogin  {
  email?:string;
  password:string;
  confirmPassword?: string
}

export interface CurrentUser {
  _id: string;
  branch: Branch;
  createdAt?:string;
  email: string
  locale?: string
  password: string
  role: string

}

