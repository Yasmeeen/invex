/** Env unlock for e-commerce integration (deployment-level). */
export function isEcommerceIntegrationFeatureAvailable() {
  const v = String(process.env.ECOMMERCE_INTEGRATION_FEATURE || '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/** Env unlock for CRM integration (deployment-level). */
export function isCrmIntegrationFeatureAvailable() {
  const v = String(process.env.CRM_INTEGRATION_FEATURE || '')
    .trim()
    .toLowerCase();
  // CRM integration is available by default and is enabled by an admin from
  // Store Settings. Deployments can still hide/disable it explicitly.
  if (!v) return true;
  return v === 'true' || v === '1' || v === 'yes';
}
