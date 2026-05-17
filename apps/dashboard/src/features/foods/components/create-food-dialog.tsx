import { CreateFoodDto, ServingUnitType } from "@/dto/food";
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
import { useAlert } from "@features/alert/hooks/use-alert";
import { createFood } from "../mutations";

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

const createSchema = z.object({
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
}) satisfies z.ZodType<CreateFoodDto>;

const emptyDefaults: Record<string, string> = {
  name: "",
  calories: "",
  fat: "",
  proteins: "",
  carbs: "",
  saturatedFat: "",
  monounsaturatedFat: "",
  polyunsaturatedFat: "",
  transFat: "",
  fiber: "",
  sugars: "",
  sodium: "",
  cholesterol: "",
  servingName: "",
  servingQuantity: "",
  servingUnitType: ServingUnitType.Weight,
};

const numericFields = [
  "calories",
  "proteins",
  "carbs",
  "fat",
  "sodium",
  "cholesterol",
];

export const CreateFoodDialog: FC<PropsWithChildren> = ({ children }) => {
  const queryClient = useQueryClient();
  const { showAlert } = useAlert();

  const mutation = useMutation({
    mutationFn: createFood,
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["foods"] });
    },
  });

  const [state, formAction] = useActionState(
    async (prev: Record<string, string>, form: FormData) => {
      try {
        const objectData = Object.fromEntries(form.entries());
        const parsedInput = createSchema.parse(objectData);
        await mutation.mutateAsync(parsedInput);
        return emptyDefaults;
      } catch (e) {
        if (e instanceof Error) {
          showAlert({ variant: "destructive", title: e.message });
        }
        return prev;
      }
    },
    emptyDefaults,
  );

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl w-full">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Add food</DialogTitle>
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

            <input
              type="hidden"
              name="servingUnitType"
              value={state.servingUnitType}
            />

            {numericFields.map((key) => (
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
            <Button type="submit">Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
