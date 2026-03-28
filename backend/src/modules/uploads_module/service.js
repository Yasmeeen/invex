import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';

let isCloudinaryConfigured = false;

const trimEnv = (key) => {
  const v = process.env[key];
  return typeof v === 'string' ? v.trim() : '';
};

/**
 * Cloudinary: CLOUDINARY_URL **or** CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET
 */
const ensureCloudinary = () => {
  if (isCloudinaryConfigured) return true;

  const url = trimEnv('CLOUDINARY_URL');
  const cloudName = trimEnv('CLOUDINARY_CLOUD_NAME');
  const apiKey = trimEnv('CLOUDINARY_API_KEY');
  const apiSecret = trimEnv('CLOUDINARY_API_SECRET');

  if (url) {
    cloudinary.config({ secure: true });
    isCloudinaryConfigured = true;
    return true;
  }

  if (cloudName && apiKey && apiSecret) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
    isCloudinaryConfigured = true;
    return true;
  }

  return false;
};

/** e.g. CLOUDINARY_FOLDER=ecommerce-store + body folder "products" → ecommerce-store/products */
function resolveCloudinaryFolder(bodyFolder) {
  const envRoot = trimEnv('CLOUDINARY_FOLDER').replace(/^\/+|\/+$/g, '');
  const sub =
    typeof bodyFolder === 'string' && bodyFolder.trim()
      ? bodyFolder.trim().replace(/^\/+|\/+$/g, '')
      : 'products';
  if (envRoot) {
    return `${envRoot}/${sub}`;
  }
  return sub;
}

const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function parseDataImageUrl(fileDataUrl) {
  const m = fileDataUrl.match(/^data:(image\/[a-zA-Z0-9+.+-]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const base64 = m[2];
  const ext = MIME_TO_EXT[mime];
  if (!ext) return null;
  try {
    const buffer = Buffer.from(base64, 'base64');
    return { mime, ext, buffer };
  } catch {
    return null;
  }
}

function safeSubfolder(folder) {
  const raw = typeof folder === 'string' && folder.trim() ? folder.trim() : 'products';
  const first = raw.split(/[/\\]/)[0];
  const cleaned = first.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'products';
}

/** When CLOUDINARY_URL is unset (e.g. local dev), store under public/uploads and serve via /uploads/… */
async function saveProductImageLocal(fileDataUrl, folder, req) {
  const parsed = parseDataImageUrl(fileDataUrl);
  if (!parsed) {
    return { error: 'Only image files are supported', status: 400 };
  }
  if (parsed.buffer.length > 8 * 1024 * 1024) {
    return { error: 'Image payload is too large', status: 400 };
  }

  const sub = safeSubfolder(folder);
  const uploadsRoot = path.join(process.cwd(), 'public', 'uploads', sub);
  await fs.mkdir(uploadsRoot, { recursive: true });

  const filename = `${randomUUID()}.${parsed.ext}`;
  const filePath = path.join(uploadsRoot, filename);
  await fs.writeFile(filePath, parsed.buffer);

  const host = req.get('host') || `localhost:${process.env.PORT || 3000}`;
  const proto = req.protocol || 'http';
  const secure_url = `${proto}://${host}/uploads/${sub}/${filename}`;
  return { secure_url };
}

export const uploadProductImage = async (req, res) => {
  try {
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

    if (!ensureCloudinary()) {
      const local = await saveProductImageLocal(fileDataUrl, folder, req);
      if (local.error) {
        return res.status(local.status).json({ error: local.error });
      }
      return res.status(200).json({ secure_url: local.secure_url });
    }

    const uploaded = await cloudinary.uploader.upload(fileDataUrl, {
      folder: resolveCloudinaryFolder(folder),
      resource_type: 'image',
    });

    return res.status(200).json({ secure_url: uploaded.secure_url });
  } catch (error) {
    console.error('uploadProductImage:', error);
    return res.status(500).json({ error: 'Failed to upload image' });
  }
};
