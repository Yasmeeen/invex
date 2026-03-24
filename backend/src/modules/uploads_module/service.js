import { v2 as cloudinary } from 'cloudinary';

let isCloudinaryConfigured = false;

const ensureCloudinary = () => {
  if (isCloudinaryConfigured) return true;
  if (!process.env.CLOUDINARY_URL) {
    return false;
  }
  cloudinary.config({ secure: true });
  isCloudinaryConfigured = true;
  return true;
};

export const uploadProductImage = async (req, res) => {
  try {
    if (!ensureCloudinary()) {
      return res.status(500).json({ error: 'Cloudinary is not configured on server' });
    }

    const { fileDataUrl, folder } = req.body || {};
    if (!fileDataUrl || typeof fileDataUrl !== 'string') {
      return res.status(400).json({ error: 'fileDataUrl is required' });
    }
    if (!fileDataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Only image files are supported' });
    }
    if (fileDataUrl.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image payload is too large' });
    }

    const uploaded = await cloudinary.uploader.upload(fileDataUrl, {
      folder: typeof folder === 'string' && folder.trim() ? folder.trim() : 'products',
      resource_type: 'image',
    });

    return res.status(200).json({ secure_url: uploaded.secure_url });
  } catch (error) {
    console.error('uploadProductImage:', error);
    return res.status(500).json({ error: 'Failed to upload image' });
  }
};

