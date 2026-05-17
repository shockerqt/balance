export const queryKeys = {
  me: () => ["me"] as const,
  foods: {
    all: () => ["foods"] as const,
    list: () => ["foods", "list"] as const,
  },
} as const;
