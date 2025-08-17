import { AlertProvider } from "@features/alert/components/alert-provider";
import { FC, PropsWithChildren } from "react";
import { QueryConfig } from "./query";

export const GlobalContext: FC<PropsWithChildren> = ({ children }) => {
  return (
    <QueryConfig>
      <AlertProvider>{children}</AlertProvider>
    </QueryConfig>
  );
};
