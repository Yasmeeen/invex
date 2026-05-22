

export interface Product {
  _id: string;
  name: string;
  branch?: Branch | null;
  category: Category;
  code: string;
  stock: number;
  /** Units reserved for pending branch-to-branch transfers */
  transferReservedQuantity?: number;
  price: number;
  netPrice: number;
  discount: number;
  /** Dynamic attributes values keyed by category attribute keys. */
  attributes?: Record<string, string>;
  quantity?: number;
  isApplyDiscount?: boolean;
  /** Central warehouse (no branch) */
  inWarehouse?: boolean;
  /** Product reservation: cashier shows warning only; sale is not blocked */
  bookingStatus?: 'none' | 'active';
  /** Sum of active booking quantities (from API) */
  bookedQuantity?: number;
  /** Active bookings that are confirmed (cashier reserved-qty warning) */
  confirmedBookedQuantity?: number;
  /** @deprecated Use bookedQuantity + bookings API */
  activeBooking?: ProductActiveBooking | null;
  /** Product photo URL (e.g. Cloudinary https) */
  imageUrl?: string;
  /** Optional: employee name who added / registered the device */
  addedBy?: string;
  /** Optional source: client or supplier the device was acquired from */
  acquiredFrom?: ProductAcquiredFrom | null;
}

/** Payload / API shape for optional device source (client or supplier). */
export interface ProductAcquiredFrom {
  partyType?: 'client' | 'supplier';
  clientId?: string;
  vendorId?: string;
  displayName?: string;
  phone?: string;
  /** Sent on create/update; server maps to displayName */
  name?: string;
  address?: string;
}

export interface ProductActiveBooking {
  _id: string;
  customerName: string;
  customerPhone: string;
  quantity?: number;
  pickupType: 'branch_pickup' | 'online_shipping';
  shippingAddress?: string;
  depositAmount: number;
  /** Screenshot / receipt of deposit transfer (URL). */
  depositTransferImageUrl?: string;
  /** Multiple transfer proof images (new bookings). */
  depositTransferImageUrls?: string[];
  /** Phone number the deposit was transferred from (bank reference). */
  transferReferencePhone?: string;
  /** Legacy / report field; new bookings use server time. */
  bookingDate?: string;
  /** When the booking was recorded (show in UI). */
  createdAt?: string;
  status?: string;
  createdBy?: { _id?: string; name?: string };
  /** Informational: manager approved the booking */
  confirmed?: boolean;
  confirmedAt?: string;
  confirmedBy?: { _id?: string; name?: string };
  productInWarehouse?: boolean;
}
export interface Category {
  _id: string;
  name: string;
  /** Prefix for product codes (e.g. ELEC → ELEC-001) */
  code?: string;
  /** Each unit gets its own SKU/code when quantity > 1 */
  multiCodePerPiece?: boolean;
  /** Dynamic attributes definition (new format: string keys; legacy: objects with key/label). */
  attributeDefs?:
    | string[]
    | Array<{
        key: string;
        label?: string;
        showOnInvoice?: boolean;
        /** When true, only the value (not the label) is printed on the barcode sticker. */
        showInBarcode?: boolean;
        options?: Array<{ value: string; label: string }>;
      }>;
  productsCount: number;
  totalItems: number;
}

export interface Branch {
  _id: string;
  name: string;
  storeAddress: string;
  rent: number;
  employeesSalary: number;
  branchInvoices: number;
  expenses: number;
}

/** Snapshot line item on a saved order (API shape; not a full Product). */
export interface OrderProductLine {
  productId?: string;
  name: string;
  code: string;
  quantity: number;
  price?: number;
  cost?: number;
  isApplyDiscount?: boolean;
  invoiceAttributes?: Array<{ label: string; value: string }>;
}

export type OrderPartyType = 'client' | 'supplier';

export interface Order {
  _id?: string;
  partyType?: OrderPartyType;
  vendorId?: string;
  clientName: string;
  clientPhoneNumber: string;
  sellerName: string;
  clientAddress: string
  branch?:  Branch;
  numberOfProducts? : number;
  /** After line-item discounts, before invoice-level discount (new orders). */
  subtotalPrice?: number;
  /** Extra cashier discount on the whole bill. */
  invoiceDiscountAmount?: number;
  totalPrice?: number;
  /** Credit sales tracking */
  amountPaid?: number;
  paymentStatus?: 'unpaid' | 'partial' | 'paid';
  payments?: Array<{
    amount: number;
    paidAt: string;
    paidByUserId?: string;
    method?: string;
    note?: string;
  }>;
  products?: OrderProductLine[];
  orderNumber?: number;
  paymentMethod?: string;
  status?: string;
  createdAt?: string;
}
export interface productOrder{
  _id?: string;
quantity: number;
totalPrice: number;    // changed to number
selectedProduct: any
}  

export interface Installment {
  date: string;       // ISO date string (e.g. "2025-10-25")
  paid: boolean;      // true if paid, false if not
}

export interface VendorLedgerEntry {
  type:
    | 'deposit'
    | 'settlement'
    | 'order_payment'
    | 'purchase'
    | 'purchase_installment_paid'
    | 'purchase_deferred'
    | 'purchase_deferred_paid';
  amount: number;
  orderId?: string;
  orderNumber?: number;
  purchasingRequestId?: string;
  note?: string;
  createdAt?: string;
  createdByUserId?: string;
}

export interface Vendor {
  _id?: string;
  nameOfcompany: string;
  name: string;
  email?: string;
  phone: string;
  address?: string;
  transactionCurrency?: string;
  paymentTerms: string[] ;
  categories: Category[];         // Array of Category IDs
  creditBalance?: number;
  ledgerEntries?: VendorLedgerEntry[];
  createdAt?: string;
  updatedAt?: string;
}

export interface VendorPurchasingRequestRow {
  _id?: string;
  requestDate?: string;
  requestedBy?: string;
  status?: string;
  totalAmount?: number;
  amountPaid?: number;
  remaining?: number;
  paymentStatus?: 'Installments' | 'Deferred' | string;
}

export interface VendorSettlementPreview {
  debitTotal: number;
  creditTotal: number;
  settleAmount: number;
  afterDebit: number;
  afterCredit: number;
  netAfter?: { who: 'supplier' | 'store' | 'even'; amount: number } | null;
  canSettle: boolean;
}

export interface VendorHistoryResponse {
  vendor: Vendor;
  supplierOwesUs: number;
  owesFromSales?: number;
  /** Total credit = prepaid + purchase payables (for display and netting). */
  weOweSupplier: number;
  /** Prepaid deposit held for supplier (subset of weOweSupplier). */
  prepaidBalance?: number;
  /** Unpaid installment + deferred amounts (subset of weOweSupplier). */
  purchasePayable?: number;
  purchasePayableInstallments?: number;
  purchasePayableDeferred?: number;
  canSettle: boolean;
  settlementPreview?: VendorSettlementPreview;
  netBalanceMessage?: { who: 'supplier' | 'store' | 'even'; amount: number } | null;
  orders: Array<Order & { remaining?: number }>;
  purchasingRequests?: VendorPurchasingRequestRow[];
  ledgerEntries: VendorLedgerEntry[];
}


export interface PurchasingRequest {
  _id?: string;
  supplier: Vendor; // vendor ID
  requestDate: Date;
  status: 'Received' | 'Pending' | 'Ordered';
  paymentTerms: string[];
  installments?: {
    dueDate: Date;
    amount: number;
    paid: boolean;
  }[];
  purchasingDetails?: string;
  paymentStatus: 'Paid' | 'Due';
  totalAmount: number;
  products?: string[]; // array of product IDs
  createdAt?: Date;
  updatedAt?: Date;
}


