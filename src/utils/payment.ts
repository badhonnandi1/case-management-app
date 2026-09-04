export function parsePaymentAmountMinor(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error('Enter a non-negative amount with no more than two decimal places.');
  }
  const [whole = '0', fraction = ''] = normalized.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Payment amount is too large.');
  return amount;
}

export function formatPaymentAmountMinor(value: number | null): string {
  if (value === null) return '';
  const whole = Math.floor(value / 100);
  const fraction = value % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`;
}
