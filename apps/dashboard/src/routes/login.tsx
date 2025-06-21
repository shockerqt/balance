import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/login")({
  component: RouteComponent,
});

function RouteComponent() {
  const handleLogin = () => {
    window.location.href = "http://localhost:8080/auth/google";
  };

  return <button onClick={handleLogin}>Iniciar sesión con Google</button>;
}
