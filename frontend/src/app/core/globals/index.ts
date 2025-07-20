// globals.ts
import {Injectable} from '@angular/core';
import { CurrentUser } from '@core/models/users-interfaces.model';
import {Subject, BehaviorSubject} from 'rxjs';

@Injectable()
export class Globals {
  static phonePattern = '^((\\+91-?)|0)?[0-9]{10}$';
  static oneDriveExtensions = ['ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx'];
  static oneDriveUrl = 'https://view.officeapps.live.com/op/view.aspx?src=';

  currentUser: CurrentUser
  sessionHeaders: any  = null;
  currentSchool:any = currentSchool; // timezone is Cairo (UTC+02:00) by default
  siteHasMessage: boolean = false;
  siteMessage: string = '';
  siteMessageType: string = '';
  componentLoader: boolean = false;
  unseenNotificationsCount = 0;
  notificationsLoaded = false;
  unreadMessagesCount = 0;
  timezone: any = '' ;
  unreadAnnouncementsCount = 0;
  applyGradingSystemCourses = null;
  updateUserLanguage: Subject<string> = new Subject<string>();
  viewAs: BehaviorSubject<any> = new BehaviorSubject<any>(null);
  updateMessagesReadList: BehaviorSubject<any> = new BehaviorSubject<any>([]);
  viewCourseAs = null;
  currentCourseParams: Subject<any> = new Subject<any>();
  updateMessagesListWhenDelete: BehaviorSubject<any> = new BehaviorSubject<any>([]);
  enabledWirisCourse: BehaviorSubject<any> = new BehaviorSubject<any>({enabledWiris: null});
  updateZonePostsCount: BehaviorSubject<any> = new BehaviorSubject<any>({zonePostsCount: 0});
  isUserAdminOrZoneManger:  BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  systemAlerts = {
    noConnection: false,
    newVersion: false,
    noPermission: false,
  };
  screenType = "desktop";
  colors = ['#fd8268', '#06c4cc', '#007ee5', '#51be7d', '#ffcc02', '#57429a', '#ff79a6', '#d8860d', '#d83c1c'];
  actorColors = {
    parent: '#06c4cc',
    student: '#fd8268',
    teacher: '#007ee5',
    hod: '#51be7d',
    admin: '#36066b'
  };
  legendColors = {
    content: '#ffcc02',
    quiz: '#57429a',
    assignment: '#ff79a6',
    event: '#007bbc',
    personal: '#ff9243',
    vacations: '#05a75c',
    academic: '#d83c1c',
    progress: '#00bcd4',
    lessonPlans:'#5c7ab7',
    posts:'#e67381',
    messages:'#74c161'
  };

  showMessage(type: string, message: string) {
    this.siteHasMessage = true;
    this.siteMessageType = type;
    this.siteMessage = message;
  }

  hideMessage() {
    this.siteHasMessage = false;
    this.siteMessageType = '';
    this.siteMessage = '';

  }

  showNoPermissionAlert() {
      this.systemAlerts.noPermission = true;
      setTimeout(() => {
        this.systemAlerts.noPermission = false;
      }, 3000);
  }
}

export const currentSchool = {
  id: 0,
  'school_description': '',
  'avatar_url': '',
  'address': '',
  'config': {
    'progress_reports_is_enable': false,
    'report_is_enable': false,
    'disable_export':false
  },
  'default_configs': [],
  'ga_tracking_id': '',
  'fedena_enabled': '',
  'banners': {},
  'id_number': '',
  'website': '',
  'phone': '',
  'email': '',
  'secondary_phone': '',
  'fax': '',
  'post_office_box': '',
  'students_max_no': '',
  'license_no': '',
  'time_zone': 'Africa/Cairo',
  'timezone_offset': '',
  'fedena': {
    'host': '',
    'id': 0
  }
};
