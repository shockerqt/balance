import { UserMenu } from "@features/user-menu/components/foods-list";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

export const Route = createRootRoute({
  component: () => (
    <>
      <div>
        <div className="flex justify-between">
          <div className="p-2 flex gap-2">
            <Link to="/" className="[&.active]:font-bold">
              Home
            </Link>{" "}
            <Link to="/foods" className="[&.active]:font-bold">
              Foods
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
      <TanStackRouterDevtools />
    </>
  ),
});
