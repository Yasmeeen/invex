
export interface PaginationData {
  currentPage: number;
  nextPage: number;
  prevPage: number;
  totalCount: number;
  totalPages: number
}

export class User{
  id:string;
  email?:string;
  name?:string;
  token?:string;
  role?: number;
  password?: string;
  created_at: string;
  local: string
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
  id: number;
  actable_id: number;
  actable_type: string;
  actions: [];
  avatar_url: string
  child_id?: number;
  children?: null;
  city?: string;
  country?: string;
  dateofbirth?: Date;
  email?: string
  firstname: string;
  gender: string;
  hide_grades?: boolean;
  home_address?: string;
  is_active?: boolean;
  last_sign_in_at?: Date;
  lastname: string;
  locale: string;
  middlename?: string;
  name: string;
  role: {};
  parent_id?: number;
  password: string;
  phone?: string;
  realtime_ip?: string;
  school_name?: string;
  secondary_address?: string;
  secondary_phone?: string;
  show_school_fees?: string;
  thumb_url?: string;
  unseen_notifications?: number;
  user_type?: string;
  username: string;
  themeType?: string;
}

