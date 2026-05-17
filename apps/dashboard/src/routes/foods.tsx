import { queryKeys } from "@/lib/query-keys";
import { FoodsHeader } from "@features/foods/components/foods-headers";
import { FoodsList } from "@features/foods/components/foods-list";
import { getMe } from "@features/user-menu/queries";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Suspense } from "react";

export const Route = createFileRoute("/foods")({
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData({
        queryKey: queryKeys.me(),
        queryFn: getMe,
        retry: false,
      });
    } catch {
      throw redirect({ to: "/login" });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div>
      <FoodsHeader />
      <Suspense>
        <FoodsList />
      </Suspense>
    </div>
  );
}
