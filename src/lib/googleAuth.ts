import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

/** Must match src-tauri loopback listener + Supabase redirect allow-list. */
export const GOOGLE_OAUTH_LOOPBACK_REDIRECT =
  "http://127.0.0.1:17843/auth/callback";

const GIS_SRC = "https://accounts.google.com/gsi/client";

type CredentialResponse = {
  credential?: string;
};

type PromptMomentNotification = {
  isNotDisplayed: () => boolean;
  isSkippedMoment: () => boolean;
  getNotDisplayedReason: () => string;
};

type GoogleAccountsId = {
  initialize: (config: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }) => void;
  prompt: (listener?: (notification: PromptMomentNotification) => void) => void;
  renderButton: (
    parent: HTMLElement,
    options: Record<string, string | number | boolean>,
  ) => void;
  cancel: () => void;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: GoogleAccountsId;
      };
    };
  }
}

let gisLoadPromise: Promise<void> | null = null;

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export function getGoogleClientId(): string | null {
  const id = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();
  if (!id || id.length < 20 || id.includes("your-")) return null;
  return id;
}

export function isGoogleAuthConfigured(): boolean {
  return Boolean(getGoogleClientId());
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SRC}"]`,
    );
    if (existing) {
      if (window.google?.accounts?.id) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => {
          gisLoadPromise = null;
          reject(new Error("Failed to load Google sign-in."));
        },
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoadPromise = null;
      reject(new Error("Failed to load Google sign-in."));
    };
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

/**
 * Browser-only fallback (Vite in Chrome). Packaged / Tauri builds use the
 * system-browser + loopback path so every installer user gets website-style login.
 */
async function requestGoogleIdToken(): Promise<string> {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error("Add VITE_GOOGLE_CLIENT_ID to your .env file.");
  }

  await loadGis();
  const googleId = window.google?.accounts?.id;
  if (!googleId) {
    throw new Error("Google sign-in is unavailable.");
  }

  return new Promise((resolve, reject) => {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;";
    document.body.appendChild(host);

    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      host.remove();
      try {
        googleId.cancel();
      } catch {
        /* ignore */
      }
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const succeed = (credential: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(credential);
    };

    const timeoutId = window.setTimeout(() => {
      fail("Google sign-in timed out. Try again.");
    }, 120_000);

    googleId.initialize({
      client_id: clientId,
      callback: (response) => {
        if (response.credential) {
          succeed(response.credential);
        } else {
          fail("Google sign-in was cancelled.");
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    googleId.renderButton(host, {
      type: "standard",
      theme: "outline",
      size: "large",
      width: 280,
      text: "signin_with",
    });

    host.style.pointerEvents = "auto";

    googleId.prompt((notification) => {
      if (settled) return;
      if (!notification.isNotDisplayed() && !notification.isSkippedMoment()) {
        return;
      }

      const btn = host.querySelector<HTMLElement>("div[role='button']");
      if (btn) {
        btn.click();
        return;
      }

      const reason = notification.isNotDisplayed()
        ? notification.getNotDisplayedReason()
        : "skipped";
      fail(
        `Google sign-in unavailable (${reason}). Add http://localhost:1420 to Google Cloud Authorized JavaScript origins.`,
      );
    });
  });
}

/**
 * Opens the user's real browser for Google account pick (works for installed apps).
 * Supabase redirects back to a local loopback URL the desktop app is listening on.
 */
async function completeGoogleSignInViaSystemBrowser(
  client: SupabaseClient<Database>,
): Promise<void> {
  const callbackPromise = invoke<string>("wait_oauth_loopback_callback", {
    timeoutSecs: 180,
  });

  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: GOOGLE_OAUTH_LOOPBACK_REDIRECT,
      skipBrowserRedirect: true,
      queryParams: {
        prompt: "select_account",
      },
    },
  });

  if (error) throw new Error(error.message);
  if (!data.url) throw new Error("Google sign-in URL was not returned.");

  await open(data.url);

  const callbackUrl = await callbackPromise;
  const parsed = new URL(callbackUrl);
  const code = parsed.searchParams.get("code");
  if (!code) {
    const oauthError =
      parsed.searchParams.get("error_description") ||
      parsed.searchParams.get("error") ||
      "Google sign-in did not return a code.";
    throw new Error(oauthError);
  }

  const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
  if (exchangeError) throw new Error(exchangeError.message);
}

/**
 * Desktop (Tauri): system browser OAuth — works for every downloaded install.
 * Browser Vite only: GIS inside the page (dev convenience).
 */
export async function completeGoogleSignIn(
  client: SupabaseClient<Database>,
): Promise<void> {
  if (isTauriRuntime()) {
    await completeGoogleSignInViaSystemBrowser(client);
    return;
  }

  const token = await requestGoogleIdToken();
  const { error } = await client.auth.signInWithIdToken({
    provider: "google",
    token,
  });
  if (error) throw new Error(error.message);
}
