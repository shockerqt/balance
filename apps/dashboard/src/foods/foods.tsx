"use client";
import { use } from "react";
import { Food } from "./queries";
import { FoodItem } from "./food-item";

export function FoodList({ getFoods }: { getFoods: Promise<Food[]> }) {
  const foods = use(getFoods);

  return (
    <ul className="grid grid-cols-3 gap-2">
      {foods.map((food) => (
        <FoodItem food={food} key={food.id} />
      ))}
    </ul>
  );
}
