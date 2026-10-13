/**
 * Word Error Rate helpers for offline evaluation.
 *
 * Tokenization: lowercase, strip most punctuation, split on whitespace.
 * Contractions and hyphens are normalized conservatively.
 * This is a development metric — not a claim of production accuracy.
 */

export function normalizeForWer(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeForWer(text: string): string[] {
  const n = normalizeForWer(text);
  return n ? n.split(" ") : [];
}

export type WerResult = {
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceTokens: number;
  hypothesisTokens: number;
};

/** Classic Levenshtein alignment over word tokens → WER. */
export function computeWer(reference: string, hypothesis: string): WerResult {
  const ref = tokenizeForWer(reference);
  const hyp = tokenizeForWer(hypothesis);
  const n = ref.length;
  const m = hyp.length;

  if (n === 0) {
    return {
      wer: m === 0 ? 0 : 1,
      substitutions: 0,
      deletions: 0,
      insertions: m,
      referenceTokens: 0,
      hypothesisTokens: m,
    };
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array<number>(m + 1).fill(0),
  );
  for (let i = 0; i <= n; i++) dp[i]![0] = i;
  for (let j = 0; j <= m; j++) dp[0]![j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1, // deletion
        dp[i]![j - 1]! + 1, // insertion
        dp[i - 1]![j - 1]! + cost, // sub / match
      );
    }
  }

  // Backtrack for S/D/I counts.
  let i = n;
  let j = m;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i]![j] === dp[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      if (ref[i - 1] !== hyp[j - 1]) substitutions += 1;
      i -= 1;
      j -= 1;
    } else if (i > 0 && dp[i]![j] === dp[i - 1]![j]! + 1) {
      deletions += 1;
      i -= 1;
    } else {
      insertions += 1;
      j -= 1;
    }
  }

  return {
    wer: (substitutions + deletions + insertions) / n,
    substitutions,
    deletions,
    insertions,
    referenceTokens: n,
    hypothesisTokens: m,
  };
}

/** Fraction of expected technical terms present in the hypothesis. */
export function technicalTermHitRate(
  hypothesis: string,
  expectedTerms: string[],
): { hitRate: number; hits: string[]; misses: string[] } {
  const hyp = normalizeForWer(hypothesis);
  const hits: string[] = [];
  const misses: string[] = [];
  for (const term of expectedTerms) {
    const t = normalizeForWer(term);
    if (!t) continue;
    if (hyp.includes(t)) hits.push(term);
    else misses.push(term);
  }
  const total = hits.length + misses.length;
  return {
    hitRate: total === 0 ? 1 : hits.length / total,
    hits,
    misses,
  };
}
