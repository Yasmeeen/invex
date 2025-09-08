

export interface Product {
  _id: string;
  name: string;
  branch: Branch;
  category: Category;
  code: string;
  stock: number;
  price: number
}
export interface Category {
  _id: string;
  name: string;
  numberOfProducts: number
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
}
export interface productOrder{
  _id: string;
code: string;
name: string;
quantity: number;
price: number;    // changed to number
discount: number;
selectedProduct: any
}  