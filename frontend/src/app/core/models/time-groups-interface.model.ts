import { Employee, EmployeesAttributes } from "./employees-interface.model";
import { Rule } from "./rules-interfaces.model";

export class TimeGroup {

    constructor() { }
    name: string;
    id?: number;
    group_type: string;
    number_of_employees?: number;
    employees?: Employee[];
    employees_attributes?: EmployeesAttributes;
    time_group_schedule_attributes?: {
        schedule_days_attributes?: TimeGroupSchedule[],
        schedule_days?: TimeGroupSchedule[]
    };
    time_group_schedule?: {
        schedule_days?: TimeGroupSchedule[]
        schedule_days_attributes?: TimeGroupSchedule[],
    };
    rule?: Rule;
    rule_id?: number | null;

}

export class TimeGroupSchedule {
    day: string;
    clock_in?: string | null;
    clock_out?: string | null;
    is_off?: boolean;
    calculate_bridging?: boolean;
    invalidTime?: boolean;
    isShowCountAsBridge?: boolean;
}