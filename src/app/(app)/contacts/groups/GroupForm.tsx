"use client";

import { useActionState } from "react";
import { addGroup } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

export function GroupForm() {
  const [state, action] = useActionState(addGroup, undefined);
  return (
    <form action={action} className="panel row" style={{ alignItems: "flex-end" }}>
      <label className="field" style={{ flex: "1 1 220px" }}><span>New group name</span><input name="name" required /></label>
      <SubmitButton pendingText="Adding…">Add group</SubmitButton>
      {state?.error && <p className="error-text" style={{ width: "100%" }}>{state.error}</p>}
    </form>
  );
}
