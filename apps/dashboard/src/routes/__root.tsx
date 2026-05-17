import { GlobalAlert } from "@features/alert/components/global-alert";
import { UserMenu } from "@features/user-menu/components/user-menu";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Link,
  Outlet,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { ErrorBoundary } from "react-error-boundary";

export interface RouterContext {
  queryClient: QueryClient;
}

const RootErrorFallback = ({ error }: { error: Error }) => (
  <div className="p-8">
    <h1 className="text-xl font-semibold">Algo salió mal</h1>
    <p className="text-muted-foreground mt-2 text-sm">
      {error.message ?? "Error desconocido"}
    </p>
    <a href="/" className="mt-4 inline-block underline">
      Volver al inicio
    </a>
  </div>
);

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <div>
      <div>
        <div className="flex justify-between">
          <div className="flex gap-2 p-2">
            <Link to="/" className="[&.active]:font-bold">
              Home
            </Link>{" "}
            <Link to="/foods" className="[&.active]:font-bold">
              Foods
            </Link>
          </div>
          <div className="flex gap-2 p-2">
            <UserMenu />
          </div>
        </div>
        <hr />
        <ErrorBoundary FallbackComponent={RootErrorFallback}>
          <Outlet />
        </ErrorBoundary>
      </div>
      <GlobalAlert />
      <TanStackRouterDevtools />
    </div>
  ),
});
