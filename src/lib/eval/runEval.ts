import { extractAudienceQuestionTexts } from "../extractAudienceQuestions";
import { sanitizeTranscript } from "../sanitizeTranscript";
import {
  SYNTHETIC_EVAL_CASES,
  SYNTHETIC_EVAL_DISCLAIMER,
  type SyntheticEvalCase,
} from "./fixtures/syntheticCases";
import { computeWer, technicalTermHitRate } from "./wer";

export type CaseReport = {
  id: string;
  kind: "synthetic";
  wer: number;
  termHitRate: number;
  questionPrecision: number | null;
  questionRecall: number | null;
  notes: string[];
};

export type EvalReport = {
  kind: "synthetic";
  disclaimer: string;
  realWorldMeasured: false;
  cases: CaseReport[];
  averages: {
    wer: number;
    termHitRate: number;
  };
};

function questionMetrics(
  predicted: string[],
  expected: string[],
): { precision: number | null; recall: number | null } {
  if (expected.length === 0 && predicted.length === 0) {
    return { precision: 1, recall: 1 };
  }
  if (expected.length === 0) {
    return { precision: predicted.length === 0 ? 1 : 0, recall: 1 };
  }
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^\w\s]/g, "").trim();
  const exp = new Set(expected.map(norm));
  const pred = predicted.map(norm);
  let hits = 0;
  for (const p of pred) if (exp.has(p)) hits += 1;
  const precision = pred.length === 0 ? 0 : hits / pred.length;
  const recall = hits / expected.length;
  return { precision, recall };
}

/**
 * Run deterministic text-level evaluation against synthetic fixtures.
 * Does not call live STT and does not invent audio or real-world scores.
 */
export function runSyntheticEval(
  cases: SyntheticEvalCase[] = SYNTHETIC_EVAL_CASES,
): EvalReport {
  const reports: CaseReport[] = [];

  for (const c of cases) {
    const notes: string[] = [];
    if (c.note) notes.push(c.note);

    const hypUi = sanitizeTranscript(c.hypothesis);
    const wer = computeWer(c.reference, hypUi);
    const terms = technicalTermHitRate(hypUi, c.expectedTerms ?? []);
    const predictedQs = extractAudienceQuestionTexts(hypUi);
    const q = questionMetrics(predictedQs, c.expectedQuestions ?? []);

    if (c.id === "hallucination-thank-you" && hypUi === "") {
      notes.push("Sanitizer correctly dropped Whisper hallucination.");
    }

    reports.push({
      id: c.id,
      kind: "synthetic",
      wer: wer.wer,
      termHitRate: terms.hitRate,
      questionPrecision: q.precision,
      questionRecall: q.recall,
      notes,
    });
  }

  const avgWer =
    reports.reduce((s, r) => s + r.wer, 0) / Math.max(1, reports.length);
  const avgTerms =
    reports.reduce((s, r) => s + r.termHitRate, 0) /
    Math.max(1, reports.length);

  return {
    kind: "synthetic",
    disclaimer: SYNTHETIC_EVAL_DISCLAIMER,
    realWorldMeasured: false,
    cases: reports,
    averages: { wer: avgWer, termHitRate: avgTerms },
  };
}
