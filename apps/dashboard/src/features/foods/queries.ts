import { apiFetch } from "@/utils/api-fetch";
import { Food } from "./types";

export type GetFoodsOutput = {
  foods: Food[];
};

export const getFoods = async () => {
  const response = await apiFetch<GetFoodsOutput>("/foods");
  return response.data;
};
