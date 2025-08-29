import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

function ensureJsonResponse(res: Response, url: string) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  // If server returned HTML (likely index.html or a dev overlay), surface a clear error
  if (ct.includes("text/html")) {
    throw new Error(
      `Received HTML instead of JSON from ${url}. ` +
      `Check that requests target your API (e.g., '/api/...') and that 'VITE_API_BASE' is correct. ` +
      `Also check server logs for a dev/build error.`
    );
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const base = (import.meta as any).env?.VITE_API_BASE || '';
  const fullUrl = url.startsWith('http') ? url : `${base}${url}`;
  const res = await fetch(fullUrl, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  ensureJsonResponse(res, fullUrl);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const base = (import.meta as any).env?.VITE_API_BASE || '';
    const path = queryKey.join("/") as string;
    const fullUrl = path.startsWith('http') ? path : `${base}${path}`;
    const res = await fetch(fullUrl, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    ensureJsonResponse(res, fullUrl);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 0, // Disable caching - always fetch fresh data
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
