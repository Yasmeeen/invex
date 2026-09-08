import crypto from 'crypto';
import User from '../DB/models/user.model.js';

const TOKEN_TTL_SECONDS = 12 * 60 * 60;

function authSecret() {
  const configured = String(process.env.AUTH_TOKEN_SECRET || '').trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== 'production') {
    return 'invex-development-only-secret-change-me';
  }
  throw new Error('AUTH_TOKEN_SECRET is required in production');
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function decodeBase64Url(input) {
  const normalized = String(input).replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function signatureFor(unsignedToken) {
  return base64Url(
    crypto.createHmac('sha256', authSecret()).update(unsignedToken).digest()
  );
}

export function createAuthToken(user, { expiresIn = TOKEN_TTL_SECONDS } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      sub: String(user?._id || ''),
      iat: now,
      exp: now + Math.max(60, Number(expiresIn) || TOKEN_TTL_SECONDS),
    })
  );
  const unsignedToken = `${header}.${payload}`;
  return `${unsignedToken}.${signatureFor(unsignedToken)}`;
}

function verifyAuthToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const unsignedToken = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(signatureFor(unsignedToken));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('Invalid token signature');
  }
  const payload = JSON.parse(decodeBase64Url(parts[1]));
  const now = Math.floor(Date.now() / 1000);
  if (!payload?.sub || !payload?.exp || Number(payload.exp) <= now) {
    throw new Error('Expired token');
  }
  return payload;
}

export async function requireAuth(req, res, next) {
  try {
    const authorization = String(req.headers.authorization || '');
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: 'Authentication required' });
    const payload = verifyAuthToken(match[1]);
    const user = await User.findById(payload.sub).select('_id name role branch').lean();
    if (!user) return res.status(401).json({ error: 'Invalid user session' });
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function allowRoles(...roles) {
  const allowed = new Set(roles.map((role) => String(role)));
  return (req, res, next) => {
    if (!req.user || !allowed.has(String(req.user.role || ''))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}
