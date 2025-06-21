const BASE_URL = "http://localhost:8080/";

export type ApiResponse<T> = {
  data: T;
};

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<ApiResponse<T>> {
  const url = new URL(path, BASE_URL);
  const res = await fetch(url.toString(), options);

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`API error: ${res.status} - ${errorBody}`);
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

  const res = await fetch(url.toString());

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GET ${url} failed: ${res.status} - ${errorText}`);
  }

  return res.json();
}

export async function post<T>(
  path: string,
  body: unknown,
): Promise<ApiResponse<T>> {
  const url = new URL(path, BASE_URL);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`POST ${url} failed: ${res.status} - ${errorText}`);
  }

  return res.json();
}
