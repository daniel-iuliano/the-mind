export type EnsembleDirection = 'BULL' | 'BEAR' | 'NEUTRAL';

export interface ProbabilisticFactor {
  name: string;
  score: number; // 0..100 confidence intensity
  weight: number; // relative importance, normalized internally
  direction: EnsembleDirection;
  reliability?: number; // 0..1 historical reliability prior
}

export interface EnsembleInput {
  factors: ProbabilisticFactor[];
  regimePenalty?: number; // 0..1, higher = more uncertainty
  contradictionPenalty?: number; // 0..1, higher = conflicting signals
}

export interface EnsembleOutput {
  bullProbability: number;
  bearProbability: number;
  neutralProbability: number;
  uncertainty: number;
  directionalEdge: number;
  confidence: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * Bayesian-like ensemble for directional forecasting.
 *
 * Intuition:
 * 1) Convert each factor into a signed evidence term using direction (+/-) and standardized score magnitude.
 * 2) Accumulate weighted log-odds evidence for bull and bear hypotheses.
 * 3) Apply uncertainty penalties for regime instability and contradictory flow.
 * 4) Convert adjusted logits to probabilities through softmax.
 *
 * This keeps interpretability (factor-by-factor contributions) while producing calibrated-like probabilities
 * in [0,1] suitable for confidence gating.
 */
export const runProbabilisticEnsemble = (input: EnsembleInput): EnsembleOutput => {
  if (input.factors.length === 0) {
    return {
      bullProbability: 0.33,
      bearProbability: 0.33,
      neutralProbability: 0.34,
      uncertainty: 1,
      directionalEdge: 0,
      confidence: 0,
    };
  }

  const totalWeight = input.factors.reduce((acc, factor) => acc + Math.max(factor.weight, 0), 0) || 1;

  let bullLogit = 0;
  let bearLogit = 0;
  let neutralSupport = 0;
  let disagreement = 0;

  for (const factor of input.factors) {
    const normalizedWeight = Math.max(factor.weight, 0) / totalWeight;
    const reliability = clamp(factor.reliability ?? 0.62, 0.2, 0.98);
    const centeredScore = clamp((factor.score - 50) / 25, -2, 2); // ~z-score-like in [-2,2]
    const magnitude = Math.abs(centeredScore);
    const evidence = centeredScore * normalizedWeight * reliability;

    if (factor.direction === 'BULL') bullLogit += evidence;
    else if (factor.direction === 'BEAR') bearLogit += -evidence;
    else neutralSupport += normalizedWeight * (1 + magnitude * 0.2);

    if (factor.direction !== 'NEUTRAL' && magnitude < 0.35) disagreement += normalizedWeight;
  }

  const regimePenalty = clamp(input.regimePenalty ?? 0, 0, 1);
  const contradictionPenalty = clamp(input.contradictionPenalty ?? 0, 0, 1);
  const uncertainty = clamp(0.2 + disagreement + regimePenalty * 0.45 + contradictionPenalty * 0.65, 0, 1);

  // Shrink logits under uncertainty to prevent overconfident tails.
  const attenuation = 1 - uncertainty * 0.55;
  bullLogit *= attenuation;
  bearLogit *= attenuation;

  const neutralLogit = -Math.abs(bullLogit - bearLogit) * 0.75 + neutralSupport * 0.8;

  const maxLogit = Math.max(bullLogit, bearLogit, neutralLogit);
  const bullExp = Math.exp(bullLogit - maxLogit);
  const bearExp = Math.exp(bearLogit - maxLogit);
  const neutralExp = Math.exp(neutralLogit - maxLogit);
  const sumExp = bullExp + bearExp + neutralExp;

  const bullProbability = bullExp / sumExp;
  const bearProbability = bearExp / sumExp;
  const neutralProbability = neutralExp / sumExp;
  const directionalEdge = bullProbability - bearProbability;
  const confidence = clamp((Math.max(bullProbability, bearProbability) - neutralProbability * 0.35) * 100, 0, 100);

  return {
    bullProbability,
    bearProbability,
    neutralProbability,
    uncertainty,
    directionalEdge,
    confidence,
  };
};

export const classifyDirection = (output: EnsembleOutput, edgeThreshold = 0.1): EnsembleDirection => {
  if (Math.abs(output.directionalEdge) < edgeThreshold || output.neutralProbability >= 0.42) return 'NEUTRAL';
  return output.directionalEdge > 0 ? 'BULL' : 'BEAR';
};

export const toPercentage = (probability: number) => Math.round(clamp(probability * 100, 0, 100));

export const scoreRegimePenalty = (regime: 'VOLATILE' | 'CALM' | 'TRENDING' | 'RANGING') => {
  if (regime === 'VOLATILE') return 0.35;
  if (regime === 'RANGING') return 0.18;
  if (regime === 'CALM') return 0.08;
  return 0.12;
};
