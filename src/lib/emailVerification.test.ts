import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { isEmailVerified } from "./emailVerification";

function user(partial: Partial<User>): User {
  return partial as User;
}

describe("isEmailVerified", () => {
  it("is false for null / missing email", () => {
    expect(isEmailVerified(null)).toBe(false);
    expect(isEmailVerified(user({ email: undefined }))).toBe(false);
  });

  it("is false when email is unconfirmed", () => {
    expect(
      isEmailVerified(
        user({ email: "a@b.com", email_confirmed_at: null, confirmed_at: null }),
      ),
    ).toBe(false);
  });

  it("is true when email_confirmed_at is set", () => {
    expect(
      isEmailVerified(
        user({ email: "a@b.com", email_confirmed_at: "2026-10-15T00:00:00Z" }),
      ),
    ).toBe(true);
  });

  it("falls back to confirmed_at", () => {
    expect(
      isEmailVerified(
        user({
          email: "a@b.com",
          email_confirmed_at: null,
          confirmed_at: "2026-10-15T00:00:00Z",
        }),
      ),
    ).toBe(true);
  });
});
