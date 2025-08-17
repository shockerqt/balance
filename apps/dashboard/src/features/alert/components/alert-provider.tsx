import { FC, PropsWithChildren, useState } from "react";
import { AlertContext, Alert } from "../contexts/alertContext";

export const AlertProvider: FC<PropsWithChildren> = ({ children }) => {
  const [alert, setAlert] = useState<Alert | null>(null);

  return (
    <AlertContext
      value={{
        alert,
        hideAlert() {
          setAlert(null);
        },
        showAlert(alert: Alert) {
          setAlert(alert);
        },
      }}
    >
      {children}
    </AlertContext>
  );
};
