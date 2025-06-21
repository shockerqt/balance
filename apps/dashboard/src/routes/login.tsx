import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";

export const Route = createFileRoute("/login")({
  component: RouteComponent,
});

function RouteComponent() {
  const handleLogin = () => {
    window.location.href = "http://localhost:8080/auth/google";
  };

  return <Button onClick={handleLogin}>Iniciar sesión con Google</Button>;
}
