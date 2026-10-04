import StoreSettings from '../../DB/models/storeSettings.model.js';
import {
  isCrmIntegrationFeatureAvailable,
  isEcommerceIntegrationFeatureAvailable,
} from './feature.js';

const getLatestSettingsDoc = () => StoreSettings.findOne().sort({ updatedAt: -1 });

/**
 * Authenticate service-to-service calls from e-commerce.
 * Expects header: x-integration-key: <shared secret>
 */
export async function requireEcommerceIntegrationAuth(req, res, next) {
  try {
    if (!isEcommerceIntegrationFeatureAvailable()) {
      return res.status(403).json({ error: 'E-commerce integration feature is disabled in env' });
    }

    const settings = await getLatestSettingsDoc();
    if (!settings?.ecommerceIntegrationEnabled) {
      return res.status(403).json({ error: 'E-commerce integration is not enabled in store settings' });
    }

    const provided = String(
      req.headers['x-integration-key'] ||
        req.headers['x-invex-integration-key'] ||
        ''
    ).trim();
    const expected = String(settings.ecommerceSharedKey || '').trim();

    if (!expected || !provided || provided !== expected) {
      return res.status(401).json({ error: 'Invalid integration key' });
    }

    req.integrationSettings = settings;
    next();
  } catch (err) {
    console.error('requireEcommerceIntegrationAuth:', err);
    res.status(500).json({ error: 'Integration auth failed' });
  }
}

/**
 * Authenticate service-to-service calls from CRM.
 * Expects header: x-integration-key (or x-invex-integration-key).
 */
export async function requireCrmIntegrationAuth(req, res, next) {
  try {
    if (!isCrmIntegrationFeatureAvailable()) {
      return res.status(403).json({ error: 'CRM integration feature is disabled in env' });
    }

    const settings = await getLatestSettingsDoc();
    if (!settings?.crmIntegrationEnabled) {
      return res.status(403).json({ error: 'CRM integration is not enabled in store settings' });
    }

    const provided = String(
      req.headers['x-integration-key'] ||
        req.headers['x-invex-integration-key'] ||
        ''
    ).trim();
    const expected = String(settings.crmSharedKey || '').trim();

    if (!expected || !provided || provided !== expected) {
      return res.status(401).json({ error: 'Invalid integration key' });
    }

    req.integrationSettings = settings;
    next();
  } catch (err) {
    console.error('requireCrmIntegrationAuth:', err);
    res.status(500).json({ error: 'Integration auth failed' });
  }
}
