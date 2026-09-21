import { isAdmin } from "@/lib/auth";
import { getBuild, listPending, listSubmitted } from "@/lib/db";
import { EVENT } from "@/lib/event";
import LoginForm from "@/components/LoginForm";
import AdminPanel from "@/components/AdminPanel";
import { logout } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

export default async function AdminPage() {
  if (!(await isAdmin())) {
    return (
      <main className="page narrow">
        <h1 className="small">Admin</h1>
        <LoginForm />
      </main>
    );
  }

  const [submitted, pending, build] = await Promise.all([listSubmitted(), listPending(), getBuild()]);

  return (
    <main className="page">
      <div className="row between">
        <h1 className="small">{EVENT.title}</h1>
        <form action={logout}>
          <button className="btn link">Sign out</button>
        </form>
      </div>
      <AdminPanel
        finalFilename={EVENT.finalFilename}
        initialBuild={JSON.parse(JSON.stringify(build))}
        submissions={submitted.map((s) => ({
          id: s.id,
          name: s.name,
          url: s.fileUrl!,
          start: s.trimStart ?? 0,
          end: s.trimEnd ?? 0,
        }))}
        pending={pending.map((s) => ({ id: s.id, name: s.name, token: s.token }))}
      />
    </main>
  );
}
