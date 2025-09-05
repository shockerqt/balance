import { createContext, JSX } from "react";

export type Alert = {
  variant?: "default" | "destructive";
  icon?: JSX.Element;
  title?: string;
  description?: string;
};

export type AlertContextType = {
  alert: Alert | null;
  showAlert: (alert: Alert) => void;
  hideAlert: () => void;
};

export const AlertContext = createContext<AlertContextType | null>(null);
