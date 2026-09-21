"use server";

import { redirect } from "next/navigation";
import { checkPassword, clearAdminCookie, setAdminCookie } from "@/lib/auth";

export async function login(_prev: string | null, formData: FormData): Promise<string | null> {
  if (!checkPassword(String(formData.get("password") ?? ""))) return "Wrong password";
  await setAdminCookie();
  redirect("/admin");
}

export async function logout() {
  await clearAdminCookie();
  redirect("/admin");
}
