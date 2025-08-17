import { get } from "@/utils/api-fetch";
import { type User } from "./types";

export type GetMeResponse = User;

export const getMe = async () => {
  const response = await get<GetMeResponse>("/me");
  return response.data;
};
