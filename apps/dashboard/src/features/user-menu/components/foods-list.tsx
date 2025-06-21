import {
  QueryErrorResetBoundary,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { Suspense, type FC } from "react";
import { getMe } from "../queries";
import { Button } from "@workspace/ui/components/button";
import { ErrorBoundary } from "react-error-boundary";
import { Link } from "@tanstack/react-router";

const Component = () => {
  const { data } = useSuspenseQuery({
    queryKey: ["me"],
    queryFn: getMe,
    retry: false,
  });

  return (
    <div>
      HOLA
      {data.user.name}
      <img src={data.user.picture} />
    </div>
  );
};

export const UserMenu: FC = () => {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          fallbackRender={({ resetErrorBoundary }) => (
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
