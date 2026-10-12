import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { endAppSession } from "../lib/appSessions";
import { DEMO_CREDENTIALS, isDemoLogin } from "../lib/demoCredentials";
import { isEmailVerified } from "../lib/emailVerification";
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

export type AuthResult = {
  error: string | null;
  needsEmailConfirmation?: boolean;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  configured: boolean;
  demoMode: boolean;
  emailVerified: boolean;
  signIn: (input: SignInInput) => Promise<AuthResult>;
  signUp: (input: SignUpInput) => Promise<AuthResult>;
  resendVerificationEmail: () => Promise<AuthResult>;
  refreshUser: () => Promise<boolean>;
  enterDemo: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [demoMode, setDemoMode] = useState(false);
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
    if (isDemoLogin(email, password)) {
      enterDemo();
      return { error: null };
    }

    if (!supabase) {
      return {
        error: "Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
      };
    }

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
    if (!supabase) {
      return {
        error: "Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
      };
    }

    const normalizedEmail = normalizeEmail(email);

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          full_name: name.trim(),
          phone: normalizePhone(phone),
        },
      },
    });

    if (error) {
      return { error: mapAuthError(error.message) };
    }

    // Supabase returns a user with empty identities when email is already taken
    // and "Confirm email" is enabled (anti-enumeration behavior varies by project).
    const identities = data.user?.identities ?? [];
    if (data.user && identities.length === 0) {
      return { error: mapAuthError("User already registered") };
    }

    // Prefer an immediate session so users can land on Start and verify later.
    if (!data.session) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (signInError) {
        return { error: mapAuthError(signInError.message) };
      }
    }

    const needsEmailConfirmation = !isEmailVerified(data.user, false);
    return { error: null, needsEmailConfirmation };
  };

  const resendVerificationEmail = useCallback(async (): Promise<AuthResult> => {
    if (!supabase) {
      return {
        error: "Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
      };
    }

    const email = user?.email;
    if (!email) {
      return { error: "No email on this account." };
    }

    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
    });

    return { error: error ? mapAuthError(error.message) : null };
  }, [user?.email]);

  const refreshUser = useCallback(async (): Promise<boolean> => {
    if (!supabase) return false;

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return false;

    setUser(data.user);
    const { data: sessionData } = await supabase.auth.getSession();
    setSession(sessionData.session);
    return isEmailVerified(data.user, demoMode);
  }, [demoMode]);

  const enterDemo = () => {
    setDemoMode(true);
    setUser({
      id: DEMO_CREDENTIALS.userId,
      email: DEMO_CREDENTIALS.email,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: { full_name: DEMO_CREDENTIALS.fullName },
      aud: "authenticated",
      created_at: new Date().toISOString(),
    } as User);
  };

  const signOut = async () => {
    setDemoMode(false);
    await endAppSession();
    setUser(null);
    setSession(null);
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  const emailVerified = isEmailVerified(user, demoMode);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        configured: isSupabaseConfigured,
        demoMode,
        emailVerified,
        signIn,
        signUp,
        resendVerificationEmail,
        refreshUser,
        enterDemo,
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
