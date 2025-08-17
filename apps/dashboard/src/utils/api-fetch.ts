const BASE_URL = "http://localhost:8080/";

export type ApiResponse<T> = {
  data: T;
};

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
    credentials: "include",
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`POST ${url} failed: ${res.status} - ${errorText}`);
  }

  return res.json();
}

export async function patch<T>(
  path: string,
  body: unknown,
): Promise<ApiResponse<T>> {
  const url = new URL(path, BASE_URL);

  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    credentials: "include",
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`PATCH ${url} failed: ${res.status} - ${errorText}`);
  }

  return res.json();
}
