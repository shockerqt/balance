import { GlobalAlert } from "@features/alert/components/global-alert";
import { UserMenu } from "@features/user-menu/components/user-menu";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Link,
  Outlet,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <div>
      <div>
        <div className="flex justify-between">
          <div className="p-2 flex gap-2">
            <Link to="/" className="[&.active]:font-bold">
              Home
            </Link>{" "}
            <Link to="/foods" className="[&.active]:font-bold">
              Foods
            </Link>
            <Link to="/test" className="[&.active]:font-bold">
              Test
            </Link>
          </div>
          <div className="p-2 flex gap-2">
            <UserMenu />
          </div>
        </div>
        <hr />
        <div>
          <Outlet />
        </div>
      </div>
      <GlobalAlert />
      <TanStackRouterDevtools />
    </div>
  ),
});
