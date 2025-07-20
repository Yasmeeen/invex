import { TimeGroup, TimeGroupSchedule } from "./time-groups-interface.model";

export interface Department {
    name: string,
    id: number,
    code: string
}
export interface Employee {
    id?: number
    code: string;
    name: string;
    department_name: string;
    employeeTitle: string;
    isSelected?: boolean
    time_group_schedule?: TimeGroupSchedule[]
    time_group?:TimeGroup,
    isInsideCurrentTimeGroup?: boolean;
    status?: string;
    email?:string;
}

export interface EmployeesAttributes {
    id: number,
    time_group_schedule_attributes: {
        schedule_days_attributes: TimeGroupSchedule[]
    }
}
