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
  additionalPhoneNumbers?: string[];
  address?:string;
  additionalAddresses?: string[];
  nationalIdImageUrl?: string;
  guarantor?: {
    name?: string;
    phoneNumber?: string;
    nationalId?: string;
    address?: string;
    nationalIdImageUrl?: string;
    notes?: string;
  };
  collectorId?: string | null;
  numberOfOrders: number;
  totalOrdersPrice: number;
  created_at: string;
  branches?: Branch[];
  creditBalance?: number;
  openingDebitBalance?: number;
  /** Debit — client owes us. */
  clientOwesUs?: number;
  /** Credit — we owe client (prepaid + deferred purchases). */
  weOweClient?: number;
  balanceSide?: 'debit' | 'credit' | 'even' | 'none';
  netBalanceMessage?: { who: 'client' | 'store' | 'even'; amount: number } | null;
  clientPayableDeferred?: number;
  /** Client originated / ordered via e-commerce storefront. */
  source?: 'store' | 'ecommerce';
  isEcommerceOnline?: boolean;
}

export interface ClientSettlementPreview {
  debitTotal: number;
  creditTotal: number;
  settleAmount: number;
  afterDebit: number;
  afterCredit: number;
  netAfter?: { who: 'client' | 'store' | 'even'; amount: number } | null;
  canSettle: boolean;
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
  isInstallment?: boolean;
  unpaidInstallmentsCount?: number;
  installmentPlanSnapshot?: { name?: string; months?: number; interestPercent?: number };
  installmentStartDate?: string;
  installments?: Array<{
    _id?: string;
    sequence?: number;
    dueDate?: string;
    amount?: number;
    paid?: boolean;
    paidAt?: string;
    paidAmount?: number;
    paymentMethod?: string;
    promiseToPayAt?: string;
    promiseToPayHistory?: Array<{
      promiseToPayAt?: string;
      recordedAt?: string;
      paidOnPromisedDay?: boolean | null;
    }>;
    promiseToPayHistoryPast?: Array<{
      promiseToPayAt?: string;
      recordedAt?: string;
      paidOnPromisedDay?: boolean | null;
    }>;
    note?: string;
  }>;
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

export interface ClientLedgerEntry {
  type: string;
  amount: number;
  paymentMethod?: string;
  note?: string;
  createdAt?: string;
}

export interface ClientHistoryResponse {
  client: Pick<Client, '_id' | 'name' | 'phoneNumber' | 'address'>;
  totalPointsEarned: number;
  /** Total debit — client owes us (orders + opening). */
  clientOwesUs?: number;
  creditBalanceDue: number;
  owesFromSales?: number;
  owesFromOpeningBalance?: number;
  /** Credit — prepaid + deferred desk purchases (we owe client). */
  weOweClient?: number;
  prepaidBalance?: number;
  clientPayable?: number;
  clientPayableDeferred?: number;
  canSettle?: boolean;
  settlementPreview?: ClientSettlementPreview;
  netBalanceMessage?: { who: 'client' | 'store' | 'even'; amount: number } | null;
  creditOrdersCount: number;
  orders: ClientHistoryOrderRow[];
  creditOrders: ClientHistoryOrderRow[];
  installmentOrders?: ClientHistoryOrderRow[];
  installmentOrdersCount?: number;
  purchases?: ClientHistoryPurchaseRow[];
  purchasesCount?: number;
  ledgerEntries?: ClientLedgerEntry[];
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

