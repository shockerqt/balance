import { useContext } from "react";
import { AlertContext } from "../contexts/alertContext";

export const useAlert = () => {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error("useAlert must be used within AlertProvider");
  return ctx;
};
