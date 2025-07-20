import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BASE_URL } from '@core/base/urls';


@Injectable()
export class UploadFilesWithPreSignedUrlService {
    constructor(
        private http: HttpClient,
    ) { }

    getPreSignedUrl(params:any) {
        return this.http.post(`${BASE_URL}/api/presigned_url`, params);
    }
    putFileToS3(body: File, presignedUrl: string){
        return this.http.put(presignedUrl, body)
    }
    getFileFromS3(publicUrl: string){
        return this.http.get(publicUrl, {responseType: 'blob'})
    }
    saveUploadedFile(params:any) {
        return this.http.post(`${BASE_URL}/api/upload_file`, params);
    }
};
