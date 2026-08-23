

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
  /**
   * When ecommerce catalog mode is "all", this SKU is listed on the website.
   * Default false.
   */
  listedOnEcommerce?: boolean;
  /** Description shown on the e-commerce store (edited in Invex). */
  ecommerceDescription?: string;
  ecommerceShortDescription?: string;
  ecommerceIsFeatured?: boolean;
  /** @deprecated Use bookedQuantity + bookings API */
  activeBooking?: ProductActiveBooking | null;
  /** Product photo URL (e.g. Cloudinary https) */
  imageUrl?: string;
  /** Optional: employee name who added / registered the product */
  addedBy?: string;
  /** null = inherit category; true/false overrides sell-by-weight. */
  sellByWeightOverride?: boolean | null;
  /**
   * When cut-from-source is on: populated source SKU or id.
   * Selling this product deducts the source's stock.
   */
  sourceProductId?: string | { _id: string; name?: string; code?: string; stock?: number } | null;
  sourceProduct?: { _id: string; name?: string; code?: string; stock?: number } | null;
  /** Cashier / order line: piece or weight. */
  saleUnit?: 'piece' | 'weight';
  weightUnit?: 'kg' | 'g';
  /** Optional source: client or supplier the product was acquired from */
  acquiredFrom?: ProductAcquiredFrom | null;
}

/** Payload / API shape for optional product source (client or supplier). */
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
  /** Pickup branch snapshot (ecommerce customer choice or product branch). */
  branch?: { _id?: string; name?: string } | string | null;
  depositAmount: number;
  /** Deposit payment method splits (cash / apps). */
  depositPayments?: Array<{ method: string; amount: number }>;
  depositPaymentFeeAllocations?: Array<{
    forMethod: string;
    feeNet: number;
    paidVia: string;
    feeGrossOnPaidVia?: number;
    feePercentSnapshot?: number;
  }>;
  /** Unit selling price snapshot at booking time. */
  productUnitPrice?: number;
  productNameSnapshot?: string;
  productCodeSnapshot?: string;
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
  source?: 'pos' | 'ecommerce';
  ecommerceOrderId?: string;
}
export interface Category {
  _id: string;
  name: string;
  /** Public image URL for the website */
  imageUrl?: string;
  /** Prefix for product codes (e.g. ELEC → ELEC-001) */
  code?: string;
  /** Each unit gets its own SKU/code when quantity > 1 */
  multiCodePerPiece?: boolean;
  /** When true, products are deleted once stock reaches 0 */
  deleteProductWhenOutOfStock?: boolean;
  /** When true (and store weightSalesEnabled), products sell by weight. */
  sellByWeight?: boolean;
  /** kg or g for sellByWeight categories. */
  weightUnit?: 'kg' | 'g';
  /** When true, product code is shown under the name on the customer invoice (default true). */
  showProductCodeOnInvoice?: boolean;
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

export interface BranchSalesperson {
  name: string;
  active?: boolean;
}

export interface Branch {
  _id: string;
  name: string;
  storeAddress: string;
  rent: number;
  employeesSalary: number;
  branchInvoices: number;
  expenses: number;
  /** Optional grand-opening date; celebration shows from the day before for one week. */
  openingDate?: string | Date | null;
  salespeople?: BranchSalesperson[];
  deliveryStaff?: BranchSalesperson[];
}

/** Snapshot line item on a saved order (API shape; not a full Product). */
export interface OrderProductLine {
  productId?: string;
  name: string;
  code: string;
  quantity: number;
  returnedQuantity?: number;
  saleUnit?: 'piece' | 'weight';
  weightUnit?: 'kg' | 'g';
  price?: number;
  cost?: number;
  isApplyDiscount?: boolean;
  /** Snapshot from category at sale time; when true, print code under product name. */
  showProductCodeOnInvoice?: boolean;
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
  /** Cashier delivery invoice. */
  isDelivery?: boolean;
  deliveryPersonName?: string;
  branch?:  Branch;
  numberOfProducts? : number;
  /** After line-item discounts, before invoice-level discount (new orders). */
  subtotalPrice?: number;
  /** Extra cashier discount on the whole bill. */
  invoiceDiscountAmount?: number;
  totalPrice?: number;
  /** بيع بالآجل: % added onto unpaid portion (already in line prices / totalPrice). */
  creditFeePercent?: number;
  creditFeeAmount?: number;
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
  /** Customer sale installment schedule */
  installmentPlanId?: string;
  installmentPlanSnapshot?: {
    name?: string;
    months?: number;
    interestPercent?: number;
  };
  installmentStartDate?: string;
  installmentPrincipal?: number;
  installmentInterestAmount?: number;
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
  products?: OrderProductLine[];
  orderNumber?: number;
  paymentMethod?: string;
  status?: string;
  createdAt?: string;
  /** Partial / full return history. */
  returns?: InvoiceReturnRecord[];
}

export interface InvoiceReturnRecord {
  returnedAt: string;
  returnAll?: boolean;
  items?: Array<{
    productId?: string;
    quantity: number;
    unitRefundPrice: number;
    lineTotal: number;
  }>;
  quantity?: number;
  unitRefundPrice?: number;
  refundTotal: number;
  refundPaymentSplits?: Array<{ method: string; amount: number }>;
  refundTreasurySplits?: Array<{ key: string; label?: string; amount: number }>;
  cashRefundVia?: 'drawer' | 'treasury';
  creditAdjustmentAmount?: number;
  deferredAdjustmentAmount?: number;
  note?: string;
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
    | 'received_deposit'
    | 'settlement'
    | 'order_payment'
    | 'opening_debit'
    | 'opening_debit_payment'
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
  /** Supplier prepaid with us (for buying from the store). */
  buyerPrepaidBalance?: number;
  openingDebitBalance?: number;
  ledgerEntries?: VendorLedgerEntry[];
  createdAt?: string;
  updatedAt?: string;
  /** Debit — supplier owes us. */
  supplierOwesUs?: number;
  /** Credit — we owe supplier. */
  weOweSupplier?: number;
  balanceSide?: 'debit' | 'credit' | 'even' | 'none';
  netBalanceMessage?: { who: 'supplier' | 'store' | 'even'; amount: number } | null;
}

export interface VendorPurchasingInstallmentRow {
  _id?: string;
  dueDate?: string;
  amount?: number;
  paid?: boolean;
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
  installments?: VendorPurchasingInstallmentRow[];
  /** Linked desk purchase invoice (ProductPurchaseRequest) when applicable. */
  purchaseInvoiceId?: string | null;
}

export interface VendorDeskPurchaseRow {
  _id?: string;
  status?: string;
  createdAt?: string;
  productName?: string;
  productCode?: string;
  quantity?: number;
  purchaseTreasuryKey?: string;
  purchaseTreasuryLabel?: string;
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

export interface ProductHistoryEvent {
  id: string;
  type: string;
  occurredAt: string;
  actorName?: string;
  summary?: string;
  details?: Record<string, unknown>;
}

export interface ProductHistoryResponse {
  product: Pick<
    Product,
    '_id' | 'name' | 'code' | 'stock' | 'inWarehouse' | 'branch' | 'category' | 'addedBy'
  > & {
    createdAt?: string;
    updatedAt?: string;
  };
  events: ProductHistoryEvent[];
}

/** Lookup by unit/serial code — includes hard-deleted (sold-out) products. */
export type ProductSerialTrackStatus =
  | 'in_stock'
  | 'out_of_stock'
  | 'removed_from_stock';

export interface ProductSerialTrackLocation {
  productId: string;
  stock: number;
  inWarehouse?: boolean;
  branchId?: string | null;
  branchName?: string;
  removedWhenOutOfStock?: boolean;
}

export interface ProductSerialTrackResponse extends ProductHistoryResponse {
  exists: boolean;
  status: ProductSerialTrackStatus;
  totalStock?: number;
  locations?: ProductSerialTrackLocation[];
  product: ProductHistoryResponse['product'] & {
    removedFromStock?: boolean;
    price?: number;
    netPrice?: number;
    attributes?: Record<string, string>;
    acquiredFrom?: ProductAcquiredFrom | null;
  };
}

export interface VendorHistoryResponse {
  vendor: Vendor;
  supplierOwesUs: number;
  owesFromSales?: number;
  /** Pre-system credit sales debt (opening debit). */
  owesFromOpeningBalance?: number;
  /** Total credit = prepaid + purchase payables (for display and netting). */
  weOweSupplier: number;
  /** Prepaid we paid supplier (subset of weOweSupplier). */
  prepaidBalance?: number;
  /** Prepaid supplier paid us for sales (subset of weOweSupplier). */
  buyerPrepaidBalance?: number;
  /** Unpaid installment + deferred amounts (subset of weOweSupplier). */
  purchasePayable?: number;
  purchasePayableInstallments?: number;
  purchasePayableDeferred?: number;
  canSettle: boolean;
  settlementPreview?: VendorSettlementPreview;
  netBalanceMessage?: { who: 'supplier' | 'store' | 'even'; amount: number } | null;
  orders: Array<Order & { remaining?: number }>;
  purchasingRequests?: VendorPurchasingRequestRow[];
  purchases?: VendorDeskPurchaseRow[];
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


