import {Directive, Input, HostBinding} from '@angular/core'
@Directive({
    selector: 'img[default]',
    host: {
      '(error)':'updateUrl()',
      '(load)': 'load()',
      '[src]':'src',
      '[class]':'class'
     }
  })
  
 export class ImagePreloadDirective {
    @Input() src:string;
    @Input() class:string;
    @Input() default:string;
    @Input() defaultClass:string;
  
    updateUrl() {
      this.src = this.default;
      this.class? this.class += ' default-image-layout ' + this.defaultClass  : this.class = 'default-image-layout ' + this.defaultClass;
    }
    load(){}
  }