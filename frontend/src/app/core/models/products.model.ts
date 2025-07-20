

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
  _id: string;
  client_name: string;
  product: Product;
  branch:  Branch;
  number_of_products : number;
  total_price: number;
  products: Product [];
}