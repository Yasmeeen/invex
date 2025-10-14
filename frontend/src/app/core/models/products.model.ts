

export interface Product {
  _id: string;
  name: string;
  branch: Branch;
  category: Category;
  code: string;
  stock: number;
  price: number;
  netPrice: number;
  discount: number;
  quantity?: number;
  isApplyDiscount?: boolean
}
export interface Category {
  _id: string;
  name: string;
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
  totalPrice?: number;
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