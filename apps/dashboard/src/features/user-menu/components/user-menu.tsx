import { apiFetch } from "@/utils/api-fetch";
import {
  QueryErrorResetBoundary,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Suspense, type FC } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { getMe } from "../queries";

const Component = () => {
  const navigate = useNavigate();
  const { data } = useSuspenseQuery({
    queryKey: ["me"],
    queryFn: getMe,
    retry: false,
  });

  return (
    <div>
      HOLA
      {data.name}
      <img src={data.picture} />
      <Button
        onClick={async () => {
          await apiFetch("/auth/logout");
          navigate({ to: "/", reloadDocument: true });
        }}
      >
        Logout
      </Button>
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
