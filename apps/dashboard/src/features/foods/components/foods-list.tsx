import { useSuspenseQuery } from "@tanstack/react-query";
import { type FC } from "react";
import { getFoods } from "../queries";
import { FoodItem } from "./food-item";

export const FoodsList: FC = () => {
  const { data } = useSuspenseQuery({
    queryKey: ["foods"],
    queryFn: getFoods,
  });

  return (
    <div className="max-w-7xl mx-auto p-2 md:p-8">
      <ul className="grid md:grid-cols-3 gap-2">
        {data.foods.map((food) => (
          <FoodItem food={food} key={food.id} />
        ))}
      </ul>
    </div>
  );
};
