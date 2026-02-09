export type FormatPriceOptions = {
  minDecimals?: number;
  maxDecimals?: number;
  significantDigits?: number;
};

const trimTrailingZeros = (value: string, minDecimals: number): string => {
  if (!value.includes('.')) return value;
  const [whole, fraction] = value.split('.');
  const trimmedFraction = fraction.replace(/0+$/, '');
  const paddedFraction = trimmedFraction.padEnd(minDecimals, '0');
  return paddedFraction.length ? `${whole}.${paddedFraction}` : whole;
};

export const formatPrice = (value: number, options: FormatPriceOptions = {}): string => {
  const {
    minDecimals = 2,
    maxDecimals = 14,
    significantDigits = 4
  } = options;

  if (!Number.isFinite(value)) return '—';
  const absValue = Math.abs(value);
  if (absValue === 0) return (0).toFixed(minDecimals);

  if (absValue >= 1) {
    return value.toFixed(minDecimals);
  }

  const exponent = Math.floor(Math.log10(absValue));
  const leadingZeros = Math.max(0, Math.abs(exponent) - 1);
  const decimals = Math.min(
    maxDecimals,
    Math.max(minDecimals, leadingZeros + significantDigits)
  );

  return trimTrailingZeros(value.toFixed(decimals), minDecimals);
};
