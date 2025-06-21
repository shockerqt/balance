import { Button } from "@workspace/ui/components/button";
import { FC } from "react";
import { UpdateFoodDialog } from "./update-food-dialog";
import { Food } from "../types";

interface Props {
  food: Food;
}

export const FoodItem: FC<Props> = ({ food }) => {
  return (
    <li className="border-1">
      <div>{food.id}</div>
      <div>{food.name} kcal</div>
      <div>Protein: {food.protein}g</div>
      <div>Carbs: {food.carbs}g</div>
      <div>Fat: {food.fat}g</div>
      <UpdateFoodDialog food={food}>
        <Button variant="outline">Editar</Button>
      </UpdateFoodDialog>
    </li>
  );
};
