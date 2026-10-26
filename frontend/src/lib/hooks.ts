import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import type { Category, City, MetaConfig, NotificationList } from "./types";

export function useMeta() {
  return useQuery({
    queryKey: ["meta"],
    queryFn: async () => {
      const [config, categories, cities] = await Promise.all([
        api.get<MetaConfig>("/meta/config"),
        api.get<Category[]>("/meta/categories"),
        api.get<City[]>("/meta/cities"),
      ]);
      return { config, categories, cities };
    },
    staleTime: 1000 * 60 * 10,
  });
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<NotificationList>("/notifications?page_size=50"),
    enabled,
    staleTime: 20_000,
  });
}

export function useMarkNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ message: string }>(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useMarkAllNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ message: string }>("/notifications/read-all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
