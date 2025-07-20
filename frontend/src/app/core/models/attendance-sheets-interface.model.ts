
export interface NationalHoliday {
    day: string
}

export interface FedenaLogFile {
  fedena_log_file: {
    url?: string|null,
  }
}

export class AttendanceSheet {
    constructor(
      public id?: number,
      public start_date: string = '' ,
      public end_date: string = '',
      public state: any  = '',
      public national_holidays: NationalHoliday[] = [],
      public uploaded_file: any = {},
      public uploaded_file_attributes: any = {},
      public national_holidays_attributes: NationalHoliday[] = [],
      public logs?: any,
      public fedena_log_file?: FedenaLogFile 
    )
    {}
  }