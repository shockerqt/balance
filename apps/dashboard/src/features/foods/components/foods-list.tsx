import { useSuspenseQuery } from "@tanstack/react-query";
import { type FC } from "react";
import { queryKeys } from "@/lib/query-keys";
import { getFoods } from "../queries";
import { FoodItem } from "./food-item";

export const FoodsList: FC = () => {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.foods.all(),
    queryFn: getFoods,
  });

  return (
    <div className="mx-auto max-w-7xl p-2 md:p-8">
      <ul className="grid gap-2 md:grid-cols-3">
        {data.foods.map((food) => (
          <FoodItem food={food} key={food.id} />
        ))}
      </ul>
    </div>
  );
};
