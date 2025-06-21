import { Button } from "@workspace/ui/components/button";
import { CreateFoodDialog } from "./create-food-dialog";

export const FoodsHeader = () => {
  return (
    <div className="flex justify-between">
      <h1 className="mb-2">Food database</h1>
      <div className="flex gap-2">
        <CreateFoodDialog>
          <Button variant="outline">Add food</Button>
        </CreateFoodDialog>
      </div>
    </div>
  );
};
