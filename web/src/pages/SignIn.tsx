import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { useAuth } from "@/hooks/auth";
import { ApiError } from "@/lib/api";
import { theme } from "@/theme";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-muted p-4">
      <Card className="w-full max-w-md">{children}</Card>
    </div>
  );
}

export function SignInPage() {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  return (
    <Shell>
      <CardHeader className="items-center text-center">
        <img src={theme.logo} alt="" className="mb-2 size-16" />
        <CardTitle className="text-2xl">{theme.appName}</CardTitle>
        <CardDescription>Sign in with the Google account your organisation set up for you.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button
          size="lg"
          onClick={() => {
            setError(null);
            signIn().catch((e: Error) => setError(e.message));
          }}
        >
          <GoogleMark /> Sign in with Google
        </Button>
        {error && <Alert variant="destructive">{error}</Alert>}
      </CardContent>
    </Shell>
  );
}

export function NoAccessPage({ error }: { error: Error | null }) {
  const { signOut, firebaseUser } = useAuth();
  const blocked = error instanceof ApiError && ["permission-denied", "failed-precondition", "unauthenticated"].includes(error.code);
  return (
    <Shell>
      <CardHeader>
        <CardTitle>{blocked ? "This account doesn't have access" : "Something went wrong"}</CardTitle>
        <CardDescription>
          {blocked
            ? `You're signed in as ${firebaseUser?.email ?? "an unknown account"}, but it hasn't been invited or has been deactivated. Ask a manager to invite this address, or sign in with a different account.`
            : (error?.message ?? "We couldn't load your account. Try again in a moment.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Button onClick={() => void signOut()}>Sign out</Button>
        {!blocked && (
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try again
          </Button>
        )}
      </CardContent>
    </Shell>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-5">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
