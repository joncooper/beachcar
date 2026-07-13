import { useEffect, useMemo, useState } from "react";

// Clerk's supported loader follows the clerk-js major channel so the hosted
// browser bundle is decoupled from the @clerk/react wrapper version.
const clerkBrowserMajorVersion = "6";

type ClerkSession = {
  getToken: (options?: Record<string, unknown>) => Promise<string | null>;
};

type ClerkSignInResource = {
  authenticateWithRedirect?: (options: Record<string, unknown>) => Promise<void>;
  create?: (options: Record<string, unknown>) => Promise<unknown>;
  ticket?: (options: { ticket: string }) => Promise<unknown>;
  status?: string | null;
  createdSessionId?: string | null;
  created_session_id?: string | null;
};

type ClerkEmailAddress = {
  emailAddress?: string;
};

type ClerkUser = {
  id?: string;
  primaryEmailAddress?: ClerkEmailAddress | null;
  emailAddresses?: ClerkEmailAddress[];
};

export type BrowserClerk = {
  loaded?: boolean;
  client?: {
    signIn?: ClerkSignInResource | null;
  };
  user: ClerkUser | null;
  session: ClerkSession | null;
  load: (options?: Record<string, unknown>) => Promise<void>;
  addListener?: (listener: () => void) => (() => void) | void;
  openSignIn: (options?: Record<string, unknown>) => void;
  setActive?: (options: { session: string }) => Promise<void>;
  signOut: (options?: Record<string, unknown>) => Promise<void>;
  mountUserButton?: (node: HTMLElement, props?: Record<string, unknown>) => void;
  unmountUserButton?: (node: HTMLElement) => void;
  mountPricingTable?: (node: HTMLDivElement, props?: Record<string, unknown>) => void;
  unmountPricingTable?: (node: HTMLDivElement) => void;
};

type ClerkAuthState = {
  clerk: BrowserClerk | null;
  email: string | null;
  error: string | null;
  isLoaded: boolean;
  isSignedIn: boolean;
};

declare global {
  interface Window {
    Clerk?: BrowserClerk;
  }
}

export function useClerkBrowser(publishableKey: string): ClerkAuthState {
  const [state, setState] = useState<ClerkAuthState>({
    clerk: null,
    email: null,
    error: null,
    isLoaded: false,
    isSignedIn: false,
  });

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | void;

    async function boot() {
      try {
        await loadClerkScript(publishableKey);
        const clerk = window.Clerk;
        if (!clerk) throw new Error("Clerk did not initialize");
        await clerk.load({});
        await acceptTicketIfPresent(clerk);

        const sync = () => {
          if (cancelled) return;
          setState({
            clerk,
            email: clerkEmail(clerk.user),
            error: null,
            isLoaded: true,
            isSignedIn: Boolean(clerk.user && clerk.session),
          });
        };

        unsubscribe = clerk.addListener?.(sync);
        sync();
      } catch (error) {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Could not load Clerk",
          isLoaded: true,
        }));
      }
    }

    void boot();
    return () => {
      cancelled = true;
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [publishableKey]);

  return useMemo(() => state, [state]);
}

async function acceptTicketIfPresent(clerk: BrowserClerk): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const ticket = params.get("__clerk_ticket") || params.get("ticket");
  if (!ticket) return;

  const signIn = clerk.client?.signIn;
  if (!signIn) throw new Error("Clerk ticket sign-in is not available");

  let result: unknown;
  if (typeof signIn.ticket === "function") {
    result = await signIn.ticket({ ticket });
  } else if (typeof signIn.create === "function") {
    result = await signIn.create({ strategy: "ticket", ticket });
  } else {
    throw new Error("Clerk ticket sign-in is not available");
  }

  const signInResult = parseSignInResult(result, signIn);
  if (signInResult.error) throw signInResult.error;
  if (signInResult.sessionId && clerk.setActive) {
    await clerk.setActive({ session: signInResult.sessionId });
    await clerk.load({});
    stripTicketFromUrl(params);
    return;
  }

  throw new Error("Clerk ticket sign-in did not create a session");
}

function parseSignInResult(result: unknown, fallback: ClerkSignInResource): { error?: Error; sessionId?: string } {
  const shaped = isRecord(result) ? result : {};
  const error = shaped.error;
  if (isRecord(error)) {
    const message = readableError(error) || "Clerk ticket sign-in failed";
    return { error: new Error(message) };
  }

  const resource = isRecord(shaped.signIn) ? shaped.signIn : shaped;
  const sessionId =
    stringField(resource, "createdSessionId") ||
    stringField(resource, "created_session_id") ||
    fallback.createdSessionId ||
    fallback.created_session_id ||
    undefined;
  return { sessionId };
}

function stripTicketFromUrl(params: URLSearchParams): void {
  params.delete("__clerk_ticket");
  params.delete("ticket");
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(null, document.title, nextUrl);
}

export async function signInWithGoogle(clerk: BrowserClerk | null): Promise<void> {
  const signIn = clerk?.client?.signIn;
  if (!signIn?.authenticateWithRedirect) throw new Error("Google sign-in is not available");
  const redirectUrl = window.location.href;
  await signIn.authenticateWithRedirect({
    strategy: "oauth_google",
    redirectUrl,
    redirectUrlComplete: redirectUrl,
  });
}

function clerkEmail(user: ClerkUser | null): string | null {
  return user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function readableError(error: Record<string, unknown>): string | null {
  for (const key of ["longMessage", "message", "code"]) {
    const value = error[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value ? value : null;
}

function loadClerkScript(publishableKey: string): Promise<void> {
  if (window.Clerk) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>("script[data-clerk-js-script]");
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Clerk script")), { once: true });
    });
  }

  const script = document.createElement("script");
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = clerkBrowserScriptUrl(publishableKey);
  script.setAttribute("data-clerk-js-script", "true");
  script.setAttribute("data-clerk-publishable-key", publishableKey);

  return new Promise((resolve, reject) => {
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Could not load Clerk script")), { once: true });
    document.head.append(script);
  });
}

function clerkBrowserScriptUrl(publishableKey: string): string {
  const frontendApi = frontendApiFromPublishableKey(publishableKey);
  return `https://${frontendApi}/npm/@clerk/clerk-js@${clerkBrowserMajorVersion}/dist/clerk.browser.js`;
}

function frontendApiFromPublishableKey(publishableKey: string): string {
  const encoded = publishableKey.replace(/^pk_(test|live)_/, "");
  const decoded = globalThis.atob(encoded);
  return decoded.replace(/\$$/, "");
}
