import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

export const Route = createRootRoute({
  component: () => (
    <>
      <div className="dark">
        <div className="flex justify-between">
          <div className="p-2 flex gap-2">
            <Link to="/" className="[&.active]:font-bold">
              Home
            </Link>{" "}
            <Link to="/foods" className="[&.active]:font-bold">
              Foods
            </Link>
            <Link to="/login" className="[&.active]:font-bold">
              Login
            </Link>
          </div>
          <div className="p-2 flex gap-2">
            <div>user</div>
          </div>
        </div>
        <hr />
        <Outlet />
      </div>
      <TanStackRouterDevtools />
    </>
  ),
});
