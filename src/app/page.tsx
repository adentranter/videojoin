import { EVENT } from "@/lib/event";

export const dynamic = "force-static";

export default function Landing() {
  return (
    <main className="page center">
      <h1>{EVENT.title} ❤️</h1>
      <p className="lead">Help us celebrate!</p>
      <p>{EVENT.description}</p>
      <form action="/api/start" method="post">
        <button className="btn primary big" type="submit">
          Record your message
        </button>
      </form>
    </main>
  );
}
