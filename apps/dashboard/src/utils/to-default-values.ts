export const toDefaultValues = (
  data: Record<string, string | number | boolean | null>,
): Record<string, string> => {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      return [key, value == null ? "" : String(value)];
    }),
  );
};
