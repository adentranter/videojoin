"use client";

import { useActionState } from "react";
import { login } from "@/app/admin/actions";

export default function LoginForm() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="card">
      <label className="field">
        Admin password
        <input type="password" name="password" autoFocus required />
      </label>
      {error && <p className="err">{error}</p>}
      <button className="btn primary" disabled={pending}>
        Sign in
      </button>
    </form>
  );
}
