import { Button } from "@workspace/ui/components/button";
import { FC } from "react";
import { UpdateFoodDialog } from "./update-food-dialog";
import { Food } from "../types";
import { Card, CardHeader } from "@workspace/ui/components/card";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@workspace/ui/components/tooltip";

interface Props {
  food: Food;
}

export const FoodItem: FC<Props> = ({ food }) => {
  return (
    <li>
      <Card>
        <Tooltip>
          <TooltipTrigger asChild>
            <CardHeader>{food.name}</CardHeader>
          </TooltipTrigger>
          <TooltipContent>
            <p>{food.id}</p>
          </TooltipContent>
        </Tooltip>
        <div>{food.id}</div>
        <div>Protein: {food.protein}g</div>
        <div>Carbs: {food.carbs}g</div>
        <div>Fat: {food.fat}g</div>
        <UpdateFoodDialog food={food}>
          <Button variant="outline">Editar</Button>
        </UpdateFoodDialog>
      </Card>
    </li>
  );
};
