import { AlertTriangle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage } from "@/lib/api";
import { Alert } from "./ui/alert";

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-muted-foreground" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span>{label}...</span>
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle aria-hidden />
      <div>{errorMessage(error)}</div>
    </Alert>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Shows the error from a mutation, if any. */
export function MutationError({ error }: { error: unknown }) {
  if (!error) return null;
  return <ErrorState error={error} />;
}

/** Renders loading and error states for a query, then children with the data. */
export function QueryView<T>({
  query,
  children,
  loadingLabel,
}: {
  query: { data: T | undefined; isLoading: boolean; error: unknown };
  children: (data: T) => ReactNode;
  loadingLabel?: string;
}) {
  if (query.isLoading) return <Loading label={loadingLabel} />;
  if (query.error) return <ErrorState error={query.error} />;
  if (query.data === undefined) return null;
  return <>{children(query.data)}</>;
}
