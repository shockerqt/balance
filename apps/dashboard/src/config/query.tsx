import { QueryClientProvider } from "@tanstack/react-query";
import { FC, PropsWithChildren } from "react";
import { queryClient } from "@/lib/query-client";

export const QueryConfig: FC<PropsWithChildren> = ({ children }) => {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};
