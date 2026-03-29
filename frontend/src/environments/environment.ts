// This file can be replaced during build by using the `fileReplacements` array.
// `ng build --prod` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
    production: false,
    env: 'development',
    apiUrl: '/api',
    /** QR code on report PDFs — Innovation technologies */
    innovationWebsiteUrl: 'https://www.innovation-tec.com/',
    /**
     * Cloudinary (browser upload uses unsigned preset only — never put API secret here).
     * Dashboard → Settings → Upload → Upload presets → add Unsigned preset, then set uploadPreset below.
     */
    cloudinary: {
        cloudName: 'drzowlo9s',
        uploadPreset: 'ml_default',
        folder: 'products',
    },
};


