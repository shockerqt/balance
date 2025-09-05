import { Button } from "@workspace/ui/components/button";
import { Pen } from "lucide-react";
import { FC } from "react";
import { UpdateFoodDialog } from "./update-food-dialog";
import { FoodDto } from "@/dto/food";

interface Props {
  food: FoodDto;
}

const formatNumber = (value: number, digits = 2) => {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
};

export const FoodItem: FC<Props> = ({ food }) => {
  return (
    <li>
      <div className="border rounded-lg px-4 p-2">
        <div className="flex justify-between gap-2">
          <h2>{food.name}</h2>
          <div>
            <UpdateFoodDialog food={food}>
              <Button variant="secondary" size="icon" className="size-6">
                <Pen strokeWidth={2} />
              </Button>
            </UpdateFoodDialog>
          </div>
        </div>
        <p>Calories: {food.calories}</p>
        <p>Carbs: {food.carbs}</p>
        <p>Fat: {food.fat}</p>
        <p>Proteins: {food.proteins}</p>
      </div>
    </li>
  );
};
