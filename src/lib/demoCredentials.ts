/** Local-only demo account — not a real Supabase user. */
export const DEMO_CREDENTIALS = {
  email: "demo@systembunny.app",
  password: "Demo@1234",
  fullName: "Demo User",
  userId: "demo-user",
} as const;

export function isDemoLogin(email: string, password: string): boolean {
  return (
    email.trim().toLowerCase() === DEMO_CREDENTIALS.email &&
    password === DEMO_CREDENTIALS.password
  );
}
