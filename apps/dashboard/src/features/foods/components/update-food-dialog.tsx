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
import { updateFood, UpdateFoodInput } from "../mutations";
import { Food } from "../types";
import { toDefaultValues } from "@/utils/to-default-values";
import { isPromise } from "util/types";
import { Update } from "vite";

interface Props extends PropsWithChildren {
  food: Food;
}

const updateSchema = z.object({
  id: z.coerce.number(),
  name: z.string(),
  calories: z.coerce.number(),
  protein: z.coerce.number(),
  carbs: z.coerce.number(),
  fat: z.coerce.number(),
  sodium: z.coerce.number(),
  cholesterol: z.coerce.number(),
});

type FormState = z.infer<typeof updateSchema>;

export const useUpdateFoodDialogForm = (defaultValues: Food) => {
  const queryClient = useQueryClient();
  const [state, formAction, isPending] = useActionState(
    async (state: Record<string, string>, form: FormData) => {
      const objectData = Object.fromEntries(form.entries());
      const parsedInput = updateSchema.parse(objectData);
      try {
        const response = await mutation.mutateAsync(parsedInput);
        console.log("RESPONSE", response.food);
        return toDefaultValues(response.food);
      } catch (e) {
        console.log(e.message);
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

const fields = ["calories", "protein", "carbs", "fat", "sodium", "cholesterol"];

export const UpdateFoodDialog: FC<Props> = ({ children, food }) => {
  const { state, formAction } = useUpdateFoodDialogForm(food);

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
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
