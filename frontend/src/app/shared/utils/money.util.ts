/** Format amounts for UI / Excel (e.g. `EGP 411,943,632.00`). */
export function formatEgpMoney(amount: number | string | null | undefined): string {
  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0);
}
