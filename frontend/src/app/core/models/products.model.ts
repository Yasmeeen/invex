

export interface Product {
  _id: string;
  name: string;
  branch?: Branch | null;
  category: Category;
  code: string;
  stock: number;
  price: number;
  netPrice: number;
  discount: number;
  quantity?: number;
  isApplyDiscount?: boolean;
  /** Central warehouse (no branch) */
  inWarehouse?: boolean;
  /** Product reservation: cashier shows warning only; sale is not blocked */
  bookingStatus?: 'none' | 'active';
  /** Sum of active booking quantities (from API) */
  bookedQuantity?: number;
  /** @deprecated Use bookedQuantity + bookings API */
  activeBooking?: ProductActiveBooking | null;
  /** Product photo URL (e.g. Cloudinary https) */
  imageUrl?: string;
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
  bookingDate: string;
  status?: string;
  createdAt?: string;
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
  /** Dynamic attributes definition (new format: string keys; legacy: objects with key/label). */
  attributeDefs?: string[] | Array<{ key: string; label?: string }>;
  productsCount: number;
  totalItems: number
}export interface Branch {
  _id: string;
  name: string;
  storeAddress: string;
  rent: number;
  employeesSalary: number;
  branchInvoices: number;
  expenses: number;
}

export interface Order {
  _id?: string;
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
    note?: string;
  }>;
  products?: Product [];
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
  createdAt?: string;
  updatedAt?: string;
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


