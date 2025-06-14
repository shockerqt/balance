import { Button } from "@/components/ui/button";
import { type Food } from "./queries";
import { UpdateFoodDialog } from "./update-food-dialog";

export function FoodItem({ food }: { food: Food }) {
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
}
