import { apiFetch } from "@/utils/api-fetch";
import { type User } from "./types";

export type GetMeResponse = {
  user: User;
};

export const getMe = async () => {
  const response = await apiFetch<GetMeResponse>("/me");
  return response.data;
};
