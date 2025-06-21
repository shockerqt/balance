import { useSuspenseQuery } from "@tanstack/react-query";
import { FC } from "react";
import { getFoods } from "../queries";
import { FoodItem } from "./food-item";

export const FoodsList: FC = () => {
  const { data } = useSuspenseQuery({
    queryKey: ["foods"],
    queryFn: getFoods,
  });

  return (
    <ul className="grid grid-cols-3 gap-2">
      {data.foods.map((food) => (
        <FoodItem food={food} key={food.id} />
      ))}
    </ul>
  );
};
