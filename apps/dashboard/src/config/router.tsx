import { createRouter, RouterProvider } from "@tanstack/react-router";
import { FC, PropsWithChildren } from "react";
import { queryClient } from "@/lib/query-client";
import { routeTree } from "../routeTree.gen";

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const router = createRouter({
  routeTree,
  context: { queryClient },
});

export const RouterConfig: FC<PropsWithChildren> = () => {
  return <RouterProvider router={router} />;
};
