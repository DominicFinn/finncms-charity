import type { OpInput, OpName, OpOutput } from "@ccm/shared";
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const opKey = <N extends OpName>(op: N, input?: OpInput<N>) => (input === undefined ? [op] : [op, input]);

/** Read operation as a query. Keyed by op name then input, so invalidating by op name refreshes every variant. */
export function useOp<N extends OpName>(
  op: N,
  input: OpInput<N>,
  options?: Omit<UseQueryOptions<OpOutput<N>>, "queryKey" | "queryFn">,
) {
  return useQuery<OpOutput<N>>({
    queryKey: opKey(op, input),
    queryFn: () => api(op, input),
    ...options,
  });
}

/**
 * Write operation as a mutation. `invalidates` lists op names whose cached
 * results should be refetched afterwards.
 */
export function useOpMutation<N extends OpName>(op: N, invalidates: OpName[] = []) {
  const qc = useQueryClient();
  return useMutation<OpOutput<N>, Error, OpInput<N>>({
    mutationFn: (input) => api(op, input),
    onSuccess: async () => {
      await Promise.all(invalidates.map((name) => qc.invalidateQueries({ queryKey: [name] })));
    },
  });
}

// Reference data used across many screens.
export const useHelpCategories = (includeArchived = false) =>
  useOp("helpCategories.list", { includeArchived }, { staleTime: 5 * 60_000 });
export const useSessionTypes = (includeArchived = false) =>
  useOp("sessionTypes.list", { includeArchived }, { staleTime: 5 * 60_000 });
export const useSessionLocations = (includeArchived = false) =>
  useOp("sessionLocations.list", { includeArchived }, { staleTime: 5 * 60_000 });
export const useDirectory = () => useOp("users.directory", {}, { staleTime: 5 * 60_000 });
export const useQuestions = (includeArchived = false) =>
  useOp("questions.list", { includeArchived }, { staleTime: 60_000 });
export const useQuestionSets = (kind?: "questionnaire" | "outcome", includeArchived = false) =>
  useOp("questionSets.list", { kind, includeArchived }, { staleTime: 60_000 });

export function useNameLookup() {
  const dir = useDirectory();
  return (uid?: string) => (uid ? dir.data?.find((u) => u.uid === uid)?.displayName ?? "Unknown user" : "");
}
