import { Button } from "@/components/ui/button";
import { CreateFoodDialog } from "./create-food-dialog";
import { FoodList } from "./foods";
import { getFoods } from "./queries";

export default function Page() {
  const foods = getFoods();

  return (
    <div>
      <div className="flex justify-between">
        <h1 className="mb-2">Food database</h1>
        <div className="flex gap-2">
          <CreateFoodDialog>
            <Button variant="outline">Add food</Button>
          </CreateFoodDialog>
        </div>
      </div>

      <FoodList getFoods={foods} />
    </div>
  );
}
