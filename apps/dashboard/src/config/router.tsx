import { createRouter, RouterProvider } from "@tanstack/react-router";
import { FC, PropsWithChildren } from "react";
import { routeTree } from "../routeTree.gen";

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const router = createRouter({
  routeTree,
});

export const RouterConfig: FC<PropsWithChildren> = () => {
  return <RouterProvider router={router} />;
};
