/**
 * Synthetic evaluation fixtures (text only).
 * Not consented audio. Real-world WER remains unmeasured.
 */
export const SYNTHETIC_EVAL_DISCLAIMER =
  "Synthetic text fixtures only. No consented audio. Real-world WER is unmeasured.";

export type SyntheticEvalCase = {
  id: string;
  domain: string;
  source: "microphone" | "meeting";
  reference: string;
  hypothesis: string;
  expectedTerms?: string[];
  expectedQuestions?: string[];
  note?: string;
};

export const SYNTHETIC_EVAL_CASES: SyntheticEvalCase[] = [
  {
    id: "fib-algo",
    domain: "algorithms",
    source: "meeting",
    reference: "How do you compute the Fibonacci sequence with recursion?",
    hypothesis: "How do you compute the Fibonacci sequence with recursion?",
    expectedTerms: ["Fibonacci sequence", "recursion"],
    expectedQuestions: [
      "How do you compute the Fibonacci sequence with recursion?",
    ],
  },
  {
    id: "fib-books",
    domain: "literature",
    source: "meeting",
    reference: "Which book in the Fibonacci series is your favorite?",
    hypothesis: "Which book in the Fibonacci series is your favorite?",
    expectedTerms: ["Fibonacci series", "book"],
    expectedQuestions: [
      "Which book in the Fibonacci series is your favorite?",
    ],
  },
  {
    id: "algo-question",
    domain: "algorithms",
    source: "meeting",
    reference: "What is the time complexity of binary search?",
    hypothesis: "What is the time complexity of binary search?",
    expectedTerms: ["time complexity", "binary search"],
    expectedQuestions: ["What is the time complexity of binary search?"],
  },
  {
    id: "accent-grammar",
    domain: "algorithms",
    source: "meeting",
    reference: "Can you explain how dynamic programming helps here?",
    hypothesis: "Can you explain how dynamic programming helps here?",
    expectedTerms: ["dynamic programming"],
    expectedQuestions: [
      "Can you explain how dynamic programming helps here?",
    ],
  },
  {
    id: "short-yes",
    domain: "general",
    source: "microphone",
    reference: "Yes",
    hypothesis: "Yes",
    expectedTerms: [],
    expectedQuestions: [],
  },
  {
    id: "short-why",
    domain: "general",
    source: "meeting",
    reference: "Why use recursion here?",
    hypothesis: "Why use recursion here?",
    expectedTerms: ["recursion"],
    expectedQuestions: ["Why use recursion here?"],
  },
  {
    id: "split-segment-a",
    domain: "algorithms",
    source: "meeting",
    reference: "We should use the Fibonacci sequence for this",
    hypothesis: "We should use the Fibonacci sequence for this",
    expectedTerms: ["Fibonacci sequence"],
    expectedQuestions: [],
  },
  {
    id: "split-segment-b-overlap",
    domain: "algorithms",
    source: "meeting",
    reference: "and then talk about memoization",
    hypothesis:
      "Fibonacci sequence for this and then talk about memoization",
    note: "Hypothesis models a repeated overlap prefix; reconcile with timing in unit tests.",
    expectedTerms: ["memoization"],
    expectedQuestions: [],
  },
  {
    id: "silence",
    domain: "general",
    source: "microphone",
    reference: "",
    hypothesis: "",
    expectedTerms: [],
    expectedQuestions: [],
  },
  {
    id: "hallucination-thank-you",
    domain: "general",
    source: "microphone",
    reference: "",
    hypothesis: "Thank you.",
    note: "Default (unknown) evidence drops courtesy hallucinations; strong evidence keeps real thank-you (unit-tested separately).",
    expectedTerms: [],
    expectedQuestions: [],
  },
  {
    id: "hallucination-subscribe",
    domain: "general",
    source: "meeting",
    reference: "",
    hypothesis: "Please like and subscribe",
    note: "Always-drop YouTube pattern regardless of evidence.",
    expectedTerms: [],
    expectedQuestions: [],
  },
];
