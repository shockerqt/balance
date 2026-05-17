import { apiFetch } from "@/utils/api-fetch";
import {
  QueryErrorResetBoundary,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Suspense, type FC } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { getMe } from "../queries";

const Component = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery({
    queryKey: ["me"],
    queryFn: getMe,
    retry: false,
  });

  const handleLogout = async () => {
    await apiFetch("/auth/logout");
    queryClient.clear();
    navigate({ to: "/login" });
  };

  return (
    <div>
      HOLA
      {data.name}
      <img src={data.picture} />
      <Button onClick={handleLogout}>Logout</Button>
    </div>
  );
};

export const UserMenu: FC = () => {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          fallbackRender={() => (
            <div>
              Hola invitado
              <Button asChild>
                <Link to="/login" className="[&.active]:font-bold">
                  Login
                </Link>
              </Button>
            </div>
          )}
        >
          <Suspense fallback="Loading..">
            <Component />
          </Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
};
