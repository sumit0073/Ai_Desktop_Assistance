export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

export type PasswordStrength = {
  score: StrengthLevel;
  label: string;
};

export function getPasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return { score: 0, label: "Enter a password" };
  }

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  const normalized = Math.min(4, score) as StrengthLevel;
  const labels: Record<StrengthLevel, string> = {
    0: "Very weak",
    1: "Weak",
    2: "Fair",
    3: "Strong",
    4: "Very strong",
  };

  // length under 6 should never look strong
  if (password.length < 6) {
    return { score: Math.min(normalized, 1) as StrengthLevel, label: labels[Math.min(normalized, 1) as StrengthLevel] };
  }

  return { score: normalized, label: labels[normalized] };
}
