import { post } from "@/utils/api-fetch";
import { Food } from "./types";

export type UpdateFoodInput = {
  id: number;
  name?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
};

export type UpdateFoodOutput = {
  food: Food;
};

export const updateFood = async (input: UpdateFoodInput) => {
  const response = await post<UpdateFoodOutput>("/foods/update", input);
  return response.data;
};
