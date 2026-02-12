export type PricingLike = {
  inputPricePerM?: number | null;
  outputPricePerM?: number | null;
};

export type AiCostBreakdown = {
  inputCost: number | null;
  outputCost: number | null;
  totalCost: number | null;
  hasPricing: boolean;
};

const TOKENS_PER_MILLION = 1_000_000;

function normalizePrice(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) return null;
  return value;
}

export function calculateAiCost(
  tokensInput: number,
  tokensOutput: number,
  pricing?: PricingLike | null
): AiCostBreakdown {
  const inputPrice = normalizePrice(pricing?.inputPricePerM);
  const outputPrice = normalizePrice(pricing?.outputPricePerM);

  if (inputPrice === null || outputPrice === null) {
    return {
      inputCost: null,
      outputCost: null,
      totalCost: null,
      hasPricing: false,
    };
  }

  const safeTokensInput = Math.max(0, Number.isFinite(tokensInput) ? tokensInput : 0);
  const safeTokensOutput = Math.max(0, Number.isFinite(tokensOutput) ? tokensOutput : 0);
  const inputCost = (safeTokensInput / TOKENS_PER_MILLION) * inputPrice;
  const outputCost = (safeTokensOutput / TOKENS_PER_MILLION) * outputPrice;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    hasPricing: true,
  };
}

export function formatCostNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1) return value.toFixed(2);
  if (abs >= 0.01) return value.toFixed(4);
  return value.toFixed(6);
}

export function formatUsdCost(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `USD ${formatCostNumber(value)}`;
}

export function formatUsdCostFormula(
  total: number | null | undefined,
  input: number | null | undefined,
  output: number | null | undefined
): string {
  if (
    typeof total !== 'number' ||
    Number.isNaN(total) ||
    typeof input !== 'number' ||
    Number.isNaN(input) ||
    typeof output !== 'number' ||
    Number.isNaN(output)
  ) {
    return '--';
  }

  return `USD ${formatCostNumber(total)} (${formatCostNumber(input)}+${formatCostNumber(output)})`;
}
