/** Env unlock for e-commerce integration (deployment-level). */
export function isEcommerceIntegrationFeatureAvailable() {
  const v = String(process.env.ECOMMERCE_INTEGRATION_FEATURE || '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}
