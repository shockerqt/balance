import { Button } from "@workspace/ui/components/button";
import { Flame, Pen, Pizza } from "lucide-react";
import { FC } from "react";
import { Food } from "../types";
import { UpdateFoodDialog } from "./update-food-dialog";

interface Props {
  food: Food;
}

const formatNumber = (value: number, digits = 0) => {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
};

export const FoodItem: FC<Props> = ({ food }) => {
  return (
    <li>
      <div
        className="border-4 p-1 px-2 flex gap-2 justify-between items-center"
        style={{ boxShadow: "4px 4px 0px 0px black" }}
      >
        <div className="flex items-center gap-2">
          <div className="bg-accent size-8">
            <Pizza strokeWidth={3} />
          </div>
          <div className="font-medium">
            <p className="font-black">{food.name}</p>
            <div className="flex gap-3">
              <div className="flex items-center">
                {formatNumber(food.calories)}
                <Flame
                  width="1em"
                  height="1em"
                  strokeWidth={3}
                  className="text-red-500"
                />
              </div>
              <div>
                {formatNumber(food.carbs)}
                <span className="font-bold text-red-500"> C</span>
              </div>
              <div>
                {formatNumber(food.fat)}
                <span className="font-bold text-red-500"> F</span>
              </div>
              <div>
                {formatNumber(food.protein)}
                <span className="font-bold text-red-500"> P</span>
              </div>
            </div>
          </div>
        </div>
        <div>
          <UpdateFoodDialog food={food}>
            <Button variant="secondary" size="icon" className="size-8">
              <Pen strokeWidth={3} />
            </Button>
          </UpdateFoodDialog>
        </div>
      </div>
    </li>
  );
};
