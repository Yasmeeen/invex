

export interface Product {
  _id: string;
  name: string;
  branch: Branch;
  category: Category;
  code: string;
  stock: number;
  price: number;
  discount: number;
}
export interface Category {
  _id: string;
  name: string;
  productsCount: number
}
export interface Branch {
  _id: string;
  name: string;
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
}
export interface productOrder{
  _id?: string;
quantity: number;
totalPrice: number;    // changed to number
selectedProduct: any
}  