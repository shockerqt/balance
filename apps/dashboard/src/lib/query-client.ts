import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/utils/api-fetch";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 min
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Don't retry on auth or client errors.
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500
        ) {
          return false;
        }
        return failureCount < 3;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
