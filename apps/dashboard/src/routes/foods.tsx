import { FoodsHeader } from "@features/foods/components/foods-headers";
import { FoodsList } from "@features/foods/components/foods-list";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

export const Route = createFileRoute("/foods")({
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
