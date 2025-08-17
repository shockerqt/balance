import { FoodDto, UpdateFoodDto } from "@/dto/food";
import { patch } from "@/utils/api-fetch";

export type UpdateFoodOutput = {
  food: FoodDto;
};

export const updateFood = async (input: UpdateFoodDto) => {
  const response = await patch<UpdateFoodOutput>("/foods/update", input);
  return response.data;
};
