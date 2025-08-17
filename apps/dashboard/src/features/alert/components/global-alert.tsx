import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { type FC } from "react";
import { useAlert } from "../hooks/useAlert";

export const GlobalAlert: FC = () => {
  const { alert, hideAlert } = useAlert();

  if (!alert) return null;

  return (
    <Alert variant={alert.variant}>
      {alert.icon}
      <AlertTitle>{alert.title}</AlertTitle>
      <AlertDescription>{alert.description}</AlertDescription>
    </Alert>
  );
};
