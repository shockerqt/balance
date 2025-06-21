import { FoodsHeader } from "@features/foods/components/foods-headers";
import { FoodsList } from "@features/foods/components/foods-list";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/foods")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div>
      <FoodsHeader />
      <FoodsList />
    </div>
  );
}
