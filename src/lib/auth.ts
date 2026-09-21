import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "tyv_admin";

const secret = () =>
  process.env.SESSION_SECRET || createHmac("sha256", "tyv").update(process.env.ADMIN_PASSWORD ?? "").digest("hex");

const sign = () => createHmac("sha256", secret()).update("admin").digest("base64url");

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  return !!expected && safeEqual(input, expected);
}

export async function setAdminCookie() {
  (await cookies()).set(COOKIE, sign(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearAdminCookie() {
  (await cookies()).delete(COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  if (!process.env.ADMIN_PASSWORD) return false;
  const v = (await cookies()).get(COOKIE)?.value;
  return !!v && safeEqual(v, sign());
}
