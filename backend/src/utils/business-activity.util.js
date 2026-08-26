/** Store business activity — butcher/farm features stay off for general retail. */

export const BUSINESS_ACTIVITY_TYPES = ['general', 'butcher', 'farm'];

export function normalizeBusinessActivityType(raw) {
  const s = String(raw || 'general').trim().toLowerCase();
  if (s === 'butcher' || s === 'farm') return s;
  return 'general';
}

export function isButcherOrFarmActivity(type) {
  const t = normalizeBusinessActivityType(type);
  return t === 'butcher' || t === 'farm';
}

export function butcherFeaturesEnabled(settings) {
  return isButcherOrFarmActivity(settings?.businessActivityType);
}

export function slaughterFeaturesEnabled(settings) {
  return butcherFeaturesEnabled(settings);
}
