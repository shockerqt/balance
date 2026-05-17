import { CreateFoodDto, FoodDto, UpdateFoodDto } from "@/dto/food";
import { patch, post } from "@/utils/api-fetch";

export type UpdateFoodOutput = {
  food: FoodDto;
};

export const updateFood = async (input: UpdateFoodDto) => {
  const response = await patch<UpdateFoodOutput>("/foods/update", input);
  return response.data;
};

export const createFood = async (input: CreateFoodDto) => {
  const response = await post<FoodDto>("/foods/create", input);
  return response.data;
};
