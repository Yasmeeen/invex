import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { from } from 'rxjs';
import { environment } from 'src/environments/environment';
import { UPLOAD_PRODUCT_IMAGE_URL } from '@core/base/urls';

/** Upload product image through backend, which uploads to Cloudinary. */
@Injectable({
  providedIn: 'root',
})
export class CloudinaryUploadService {
  constructor(private http: HttpClient) {}

  private toDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Upload image via backend (Cloudinary or local /uploads).
   * @param folder Subfolder under CLOUDINARY_FOLDER root, e.g. `products`, `booking-deposits`.
   */
  uploadProductImage(file: File, folder?: string): Observable<string> {
    const cfg = environment.cloudinary;
    if (!cfg?.cloudName) {
      return throwError(() => new Error('Cloudinary cloud name is missing in environment.'));
    }
    const resolvedFolder = (folder && folder.trim()) || cfg.folder || 'products';
    return from(this.toDataUrl(file)).pipe(
      switchMap((fileDataUrl) =>
        this.http.post<{ secure_url: string }>(UPLOAD_PRODUCT_IMAGE_URL, {
          fileDataUrl,
          folder: resolvedFolder,
        })
      ),
      map((res) => res?.secure_url || ''),
      catchError((err) => throwError(() => err))
    );
  }
}
