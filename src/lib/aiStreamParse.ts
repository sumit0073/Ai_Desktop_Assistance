export type StreamDelta = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      /** Groq gpt-oss reasoning models may stream here instead of content. */
      reasoning?: string | null;
    };
    message?: {
      content?: string | null;
      reasoning?: string | null;
    };
  }>;
};

/** Extract visible text from one OpenAI/Groq chat chunk. */
export function extractStreamDeltaText(json: StreamDelta): string {
  const choice = json.choices?.[0];
  const delta = choice?.delta;
  const message = choice?.message;
  const candidates = [
    delta?.content,
    message?.content,
    delta?.reasoning,
    message?.reasoning,
  ];
  for (const part of candidates) {
    if (typeof part === "string" && part.length > 0) return part;
  }
  return "";
}
