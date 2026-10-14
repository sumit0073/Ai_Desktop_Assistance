import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { endAppSession } from "../lib/appSessions";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { mapAuthError, normalizeEmail, normalizePhone } from "../lib/validation";

export type SignUpInput = {
  name: string;
  email: string;
  phone: string;
  password: string;
};

export type SignInInput = {
  email: string;
  password: string;
};

export type PasswordResetInput = {
  email: string;
};

export type OtpChannel = "email" | "sms";

export type SendOtpInput =
  | { channel: "email"; email: string }
  | { channel: "sms"; phone: string };

export type VerifyOtpInput =
  | { channel: "email"; email: string; token: string }
  | { channel: "sms"; phone: string; token: string };

export type AuthResult = {
  error: string | null;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  configured: boolean;
  signIn: (input: SignInInput) => Promise<AuthResult>;
  signUp: (input: SignUpInput) => Promise<AuthResult>;
  requestPasswordReset: (input: PasswordResetInput) => Promise<AuthResult>;
  sendOtp: (input: SendOtpInput) => Promise<AuthResult>;
  verifyOtp: (input: VerifyOtpInput) => Promise<AuthResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function missingConfigError(): AuthResult {
  return {
    error: "Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);

      if (event === "SIGNED_OUT") {
        await endAppSession();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async ({ email, password }: SignInInput): Promise<AuthResult> => {
    if (!supabase) return missingConfigError();

    const { error } = await supabase.auth.signInWithPassword({
      email: normalizeEmail(email),
      password,
    });

    return { error: error ? mapAuthError(error.message) : null };
  };

  const signUp = async ({
    name,
    email,
    phone,
    password,
  }: SignUpInput): Promise<AuthResult> => {
    if (!supabase) return missingConfigError();

    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          full_name: name.trim(),
          phone: normalizedPhone,
        },
      },
    });

    if (error) {
      return { error: mapAuthError(error.message) };
    }

    // Supabase returns a user with empty identities when email is already taken.
    const identities = data.user?.identities ?? [];
    if (data.user && identities.length === 0) {
      return { error: mapAuthError("User already registered") };
    }

    // Phone for SMS OTP is copied onto auth.users by the DB trigger (digits, no '+').
    // Avoid updateUser({ phone }) here — with phone confirmations on it leaves a
    // pending phone_change and can break OTP login.
    if (data.session) {
      await supabase.auth.signOut();
    }

    return { error: null };
  };

  const requestPasswordReset = async ({
    email,
  }: PasswordResetInput): Promise<AuthResult> => {
    if (!supabase) return missingConfigError();

    const redirectTo = import.meta.env.VITE_AUTH_REDIRECT_URL?.trim() || undefined;

    const { error } = await supabase.auth.resetPasswordForEmail(
      normalizeEmail(email),
      {
        ...(redirectTo ? { redirectTo } : {}),
      },
    );

    return { error: error ? mapAuthError(error.message) : null };
  };

  const sendOtp = async (input: SendOtpInput): Promise<AuthResult> => {
    if (!supabase) return missingConfigError();

    if (input.channel === "email") {
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizeEmail(input.email),
        options: {
          shouldCreateUser: false,
        },
      });
      return { error: error ? mapAuthError(error.message) : null };
    }

    const { error } = await supabase.auth.signInWithOtp({
      phone: normalizePhone(input.phone),
      options: {
        shouldCreateUser: false,
        channel: "sms",
      },
    });

    return { error: error ? mapAuthError(error.message) : null };
  };

  const verifyOtp = async (input: VerifyOtpInput): Promise<AuthResult> => {
    if (!supabase) return missingConfigError();

    const token = input.token.trim();

    if (input.channel === "email") {
      const { error } = await supabase.auth.verifyOtp({
        email: normalizeEmail(input.email),
        token,
        type: "email",
      });
      return { error: error ? mapAuthError(error.message) : null };
    }

    const { error } = await supabase.auth.verifyOtp({
      phone: normalizePhone(input.phone),
      token,
      type: "sms",
    });

    return { error: error ? mapAuthError(error.message) : null };
  };

  const signOut = async () => {
    await endAppSession();
    setUser(null);
    setSession(null);
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        configured: isSupabaseConfigured,
        signIn,
        signUp,
        requestPasswordReset,
        sendOtp,
        verifyOtp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
