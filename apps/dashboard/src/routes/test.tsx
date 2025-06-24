import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useActionState, useState } from "react";

export const Route = createFileRoute("/test")({
  component: RouteComponent,
});

type State = {
  chat: string;
};

function RouteComponent() {
  const [state, formAction, isPending] = useActionState(
    async (state: State, form: FormData) => {
      const chat = form.get("chat");

      const newState: State = {
        chat: typeof chat === "string" ? chat : "",
      };

      return newState;
    },
    {
      chat: "",
    },
  );

  return (
    <form action={formAction}>
      <div className="p-4 grid gap-2">
        <Label>Chat</Label>
        <Input
          type="text"
          name="chat"
          defaultValue={state.chat}
          placeholder="..."
        />
        <Button type="submit">Enviar</Button>
      </div>
    </form>
  );
}
