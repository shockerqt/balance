const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080/";

export type ApiResponse<T> = {
  data: T;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    public method: string,
    public url: string,
  ) {
    super(`${method} ${url} failed: ${status} - ${body}`);
    this.name = "ApiError";
  }
}

export async function apiFetch(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const url = new URL(path, BASE_URL);
  return await fetch(url.toString(), {
    credentials: "include",
    ...options,
  });
}

async function request<T>(
  method: string,
  path: string,
  init: RequestInit,
): Promise<ApiResponse<T>> {
  const url = new URL(path, BASE_URL);
  const res = await fetch(url.toString(), { credentials: "include", ...init });

  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body, method, url.toString());
  }

  return res.json();
}

export async function get<T>(
  path: string,
  queryParams?: Record<string, string | number>,
): Promise<ApiResponse<T>> {
  const url = new URL(path, BASE_URL);

  if (queryParams) {
    Object.entries(queryParams).forEach(([key, value]) =>
      url.searchParams.append(key, value.toString()),
    );
  }

  const res = await fetch(url.toString(), { credentials: "include" });

  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body, "GET", url.toString());
  }

  return res.json();
}

export async function post<T>(
  path: string,
  body: unknown,
): Promise<ApiResponse<T>> {
  return request<T>("POST", path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function patch<T>(
  path: string,
  body: unknown,
): Promise<ApiResponse<T>> {
  return request<T>("PATCH", path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
