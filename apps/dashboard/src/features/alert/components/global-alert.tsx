import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { type FC } from "react";
import { useAlert } from "../hooks/use-alert";
import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react";

export const GlobalAlert: FC = () => {
  const { alert, hideAlert } = useAlert();

  if (!alert) return null;

  const Icon =
    alert.variant === "destructive" ? AlertCircleIcon : CheckCircle2Icon;

  return (
    <div className="absolute top-4 right-4 left-4 z-[60] mx-auto max-w-xl">
      <Alert variant={alert.variant}>
        <Icon />
        <AlertTitle>{alert.title}</AlertTitle>
        <AlertDescription>{alert.description}</AlertDescription>
      </Alert>
    </div>
  );
};
