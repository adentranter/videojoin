import { notFound } from "next/navigation";
import { getByToken } from "@/lib/db";
import { EVENT } from "@/lib/event";
import Recorder from "@/components/Recorder";

export const dynamic = "force-dynamic";

export default async function RecordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sub = await getByToken(token);
  if (!sub) notFound();

  return (
    <main className="page">
      <h1 className="small">{EVENT.title} ❤️</h1>
      <Recorder
        token={token}
        initialName={sub.name}
        alreadySubmitted={!!sub.fileKey}
        maxDuration={EVENT.maxDuration}
        minDuration={EVENT.minDuration}
        targetMin={EVENT.targetMin}
        targetMax={EVENT.targetMax}
      />
    </main>
  );
}
