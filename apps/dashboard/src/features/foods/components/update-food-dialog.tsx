import { FoodDto, ServingUnitType, UpdateFoodDto } from "@/dto/food";
import { toDefaultValues } from "@/utils/to-default-values";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useActionState, type FC, type PropsWithChildren } from "react";
import { z } from "zod/v4";
import { updateFood } from "../mutations";
import { useAlert } from "@features/alert/hooks/use-alert";

const preprocessNumber = (value: unknown) => {
  if (typeof value === "string") {
    if (value) {
      const number = Number(value);
      if (Number.isNaN(number)) {
        return null;
      } else {
        return value;
      }
    }
  } else if (typeof value === "number") {
    return value;
  }
  return null;
};

interface Props extends PropsWithChildren {
  food: FoodDto;
}

const updateSchema = z.object({
  id: z.preprocess(preprocessNumber, z.int().positive()),
  name: z.string().min(1),
  calories: z.preprocess(preprocessNumber, z.int().nonnegative()),
  fat: z.preprocess(preprocessNumber, z.number().nonnegative()),
  proteins: z.preprocess(preprocessNumber, z.number().nonnegative()),
  carbs: z.preprocess(preprocessNumber, z.number().nonnegative()),
  saturatedFat: z.preprocess(
    preprocessNumber,
    z.number().nonnegative().nullable(),
  ),
  monounsaturatedFat: z.preprocess(
    preprocessNumber,
    z.number().nonnegative().nullable(),
  ),
  polyunsaturatedFat: z.preprocess(
    preprocessNumber,
    z.number().nonnegative().nullable(),
  ),
  transFat: z.preprocess(preprocessNumber, z.number().nonnegative().nullable()),
  fiber: z.preprocess(preprocessNumber, z.number().nonnegative().nullable()),
  sugars: z.preprocess(preprocessNumber, z.number().nonnegative().nullable()),
  sodium: z.preprocess(preprocessNumber, z.int().nonnegative().nullable()),
  cholesterol: z.preprocess(preprocessNumber, z.int().nonnegative().nullable()),
  servingName: z.string().min(1),
  servingQuantity: z.preprocess(preprocessNumber, z.number().nonnegative()),
  servingUnitType: z.enum(ServingUnitType),
}) satisfies z.ZodType<UpdateFoodDto>;

export const useUpdateFoodDialogForm = (defaultValues: FoodDto) => {
  const queryClient = useQueryClient();
  const { showAlert } = useAlert();

  const [state, formAction, isPending] = useActionState(
    async (state: Record<string, string>, form: FormData) => {
      try {
        const objectData = Object.fromEntries(form.entries());
        const parsedInput = updateSchema.parse(objectData);
        const response = await mutation.mutateAsync(parsedInput);
        console.log("RESPONSE", response.food);
        return toDefaultValues(response.food);
      } catch (e) {
        if (e instanceof Error) {
          console.log(e.message);
          showAlert({
            variant: "destructive",
            title: e.message,
          });
        }
      }
      return state;
    },
    toDefaultValues(defaultValues),
  );

  // useEffect(() => {
  //   setForm(defaultValues);
  // }, [defaultValues]);

  const mutation = useMutation({
    mutationFn: updateFood,
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["foods"] });
    },
  });

  return {
    state,
    formAction,
    isPending,
  };
};

const fields = [
  "calories",
  "proteins",
  "carbs",
  "fat",
  "sodium",
  "cholesterol",
];

export const UpdateFoodDialog: FC<Props> = ({ children, food }) => {
  const { state, formAction } = useUpdateFoodDialogForm(food);

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl w-full">
        <form action={formAction}>
          <input type="hidden" name="id" value={food.id} />
          <DialogHeader>
            <DialogTitle>Update food</DialogTitle>
            <DialogDescription>Add a food to the database</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-3">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={state.name} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-3">
                <Label htmlFor="servingName">Serving name</Label>
                <Input
                  id="servingName"
                  name="servingName"
                  defaultValue={state.servingName}
                />
              </div>
              <div className="grid gap-3">
                <Label htmlFor="servingQuantity">Serving quantity</Label>
                <Input
                  id="servingQuantity"
                  name="servingQuantity"
                  defaultValue={state.servingQuantity}
                />
              </div>
            </div>

            {fields.map((key) => (
              <div className="grid gap-3" key={key}>
                <Label htmlFor={key}>{key}</Label>
                <Input
                  id={key}
                  name={key}
                  type="number"
                  defaultValue={state[key]}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" value="submit">
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
