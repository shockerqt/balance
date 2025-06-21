import { get } from "@/utils/api-fetch";
import { Food } from "./types";

export type GetFoodsOutput = {
  foods: Food[];
};

export const getFoods = async () => {
  const response = await get<GetFoodsOutput>("/foods");
  return response.data;
};
