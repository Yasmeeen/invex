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

