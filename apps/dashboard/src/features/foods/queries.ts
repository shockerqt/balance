import { type GetFoodsResponse } from "@/dto/food";
import { get } from "@/utils/api-fetch";

export const getFoods = async () => {
  const response = await get<GetFoodsResponse>("/foods");
  return response.data;
};
