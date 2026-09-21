"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { fmt } from "@/lib/format";

type Sub = { id: string; name: string; url: string; start: number; end: number };
type Pending = { id: string; name: string; token: string };
type Build = {
  status: "idle" | "running" | "done" | "error";
  done: number;
  total: number;
  error: string | null;
  fileUrl: string | null;
  clipCount: number | null;
  orderSig: string | null;
  finishedAt: string | null;
};

function Row({
  s,
  index,
  current,
  onPlay,
  onDelete,
}: {
  s: Sub;
  index: number;
  current: boolean;
  onPlay: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  return (
    <li
      ref={setNodeRef}
      className={`clip${current ? " current" : ""}${isDragging ? " dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button className="handle" aria-label={`Drag to reorder ${s.name}`} {...attributes} {...listeners}>
        ⠿
      </button>
      <span className="idx">{index + 1}</span>
      <span className="who">✓ {s.name || "(no name)"}</span>
      <span className="dur">{fmt(s.end - s.start)}</span>
      <span className="row gap">
        <button className="btn small" onClick={onPlay} aria-label={`Play ${s.name}`}>
          ▶
        </button>
        <a className="btn small" href={`/api/admin/clips/${s.id}`}>
          Download
        </a>
        <button className="btn small danger-o" onClick={onDelete}>
          Delete
        </button>
      </span>
    </li>
  );
}

/** Plays the trimmed clips back to back, in list order, without building anything. */
function SequencePlayer({
  items,
  index,
  onIndex,
}: {
  items: Sub[];
  index: number;
  onIndex: (i: number | null) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const clip = items[index];
  const upcoming = items[index + 1];

  const next = () => onIndex(index + 1 < items.length ? index + 1 : null);

  // Stop each clip at its trim end (timeupdate is too coarse for this).
  useEffect(() => {
    const v = ref.current;
    if (!v || !clip) return;
    let raf = 0;
    const tick = () => {
      if (!v.paused && clip.end > 0 && v.currentTime >= clip.end - 0.03) {
        next();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items]);

  if (!clip) return null;
  return (
    <div className="card player">
      <video
        key={clip.id}
        ref={ref}
        src={clip.url}
        autoPlay
        playsInline
        onLoadedMetadata={(e) => {
          if (clip.start > 0) e.currentTarget.currentTime = clip.start;
        }}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onEnded={next}
      />
      {/* Warm the cache so the next clip starts without a gap. */}
      {upcoming && <video key={`pre-${upcoming.id}`} src={upcoming.url} preload="auto" muted hidden />}
      <div className="row between">
        <span className="hint">
          {index + 1} of {items.length} · <strong>{clip.name || "(no name)"}</strong>
        </span>
        <span className="row gap">
          <button className="btn small" disabled={index === 0} onClick={() => onIndex(index - 1)}>
            ⏮
          </button>
          <button
            className="btn small"
            onClick={() => (paused ? ref.current?.play() : ref.current?.pause())}
            aria-label={paused ? "Play" : "Pause"}
          >
            {paused ? "▶" : "⏸"}
          </button>
          <button className="btn small" onClick={next}>
            ⏭
          </button>
          <button className="btn small" onClick={() => onIndex(null)}>
            ✕
          </button>
        </span>
      </div>
    </div>
  );
}

export default function AdminPanel({
  submissions,
  pending,
  initialBuild,
  finalFilename,
}: {
  submissions: Sub[];
  pending: Pending[];
  initialBuild: Build;
  finalFilename: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState(submissions);
  const [build, setBuild] = useState(initialBuild);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [linkName, setLinkName] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // Pick up server changes (deletes, new submissions) after router.refresh().
  useEffect(() => setItems(submissions), [submissions]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Poll while a build runs.
  useEffect(() => {
    if (build.status !== "running") return;
    const t = setInterval(async () => {
      const r = await fetch("/api/admin/build", { cache: "no-store" });
      if (r.ok) setBuild(await r.json());
    }, 2000);
    return () => clearInterval(t);
  }, [build.status]);

  async function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    const before = items;
    const after = arrayMove(items, from, to);
    setItems(after);
    setOrderError(null);
    // keep the player on the same clip if the order changes under it
    if (previewIdx !== null) {
      const playingId = before[previewIdx]?.id;
      setPreviewIdx(after.findIndex((i) => i.id === playingId));
    }
    const r = await fetch("/api/admin/order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: after.map((i) => i.id) }),
    }).catch(() => null);
    if (!r?.ok) {
      setItems(before);
      setOrderError("Couldn't save the new order. Please try again.");
    }
  }

  async function startBuild() {
    setBuildError(null);
    const r = await fetch("/api/admin/build", { method: "POST" });
    if (!r.ok) {
      setBuildError((await r.json().catch(() => null))?.error ?? "Could not start build");
      return;
    }
    setBuild({ ...build, status: "running", done: 0, total: items.length + 1, error: null });
  }

  async function remove(s: Sub) {
    if (!confirm(`Delete ${s.name || "this clip"}'s message? This can't be undone.`)) return;
    setPreviewIdx(null);
    await fetch(`/api/admin/clips/${s.id}`, { method: "DELETE" });
    router.refresh();
  }

  async function removePending(p: Pending) {
    await fetch(`/api/admin/clips/${p.id}`, { method: "DELETE" });
    router.refresh();
  }

  async function copy(token: string) {
    const link = `${window.location.origin}/r/${token}`;
    await navigator.clipboard.writeText(link).catch(() => prompt("Copy this link:", link));
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  }

  async function createLink(e: React.FormEvent) {
    e.preventDefault();
    if (!linkName.trim()) return;
    const r = await fetch("/api/admin/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: linkName.trim() }),
    });
    if (!r.ok) return;
    const { token } = await r.json();
    setLinkName("");
    await copy(token);
    router.refresh();
  }

  const running = build.status === "running";
  const clipsDone = Math.min(build.done, items.length);
  const currentSig = items.map((i) => i.id).join(",");
  const stale =
    build.status === "done" &&
    (build.orderSig === null ? build.clipCount !== items.length : build.orderSig !== currentSig);

  const BuildButton = (
    <button className="btn primary big" onClick={startBuild} disabled={running || items.length === 0}>
      {running ? "Building…" : "Build Video"}
    </button>
  );

  return (
    <>
      <div className="row between">
        <p className="count">
          {items.length} submission{items.length === 1 ? "" : "s"}
        </p>
        {items.length > 0 && (
          <button className="btn small" onClick={() => setPreviewIdx(0)}>
            ▶ Play all in order
          </button>
        )}
      </div>
      {BuildButton}
      {buildError && <p className="err">{buildError}</p>}
      {running && (
        <div className="card">
          <div className="bar">
            <div style={{ width: `${(build.done / Math.max(build.total, 1)) * 100}%` }} />
          </div>
          <p className="hint">
            {clipsDone < items.length
              ? `Processing clip ${clipsDone + 1} of ${items.length}…`
              : "Joining clips and uploading the final video…"}
          </p>
        </div>
      )}
      {build.status === "error" && <p className="err">Build failed: {build.error}</p>}

      {previewIdx !== null && <SequencePlayer items={items} index={previewIdx} onIndex={setPreviewIdx} />}

      <p className="hint">Drag ⠿ to change the order. The final video follows this order.</p>
      {orderError && <p className="err">{orderError}</p>}

      <DndContext id="clips" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ul className="list">
            {items.map((s, i) => (
              <Row
                key={s.id}
                s={s}
                index={i}
                current={previewIdx === i}
                onPlay={() => setPreviewIdx(i)}
                onDelete={() => remove(s)}
              />
            ))}
            {items.length === 0 && <li className="hint">No messages yet.</li>}
          </ul>
        </SortableContext>
      </DndContext>

      {BuildButton}

      <section className="card">
        <h2>Final video</h2>
        {build.fileUrl ? (
          <>
            <p>
              {finalFilename}
              {build.clipCount != null && <span className="hint"> · {build.clipCount} clips</span>}
            </p>
            {stale && (
              <p className="note">
                The order or submissions have changed since this was built. Build again to update it.
              </p>
            )}
            <video className="preview" src={build.fileUrl} controls playsInline preload="metadata" />
            <a className="btn primary" href="/api/admin/final">
              Download
            </a>
          </>
        ) : (
          <p className="hint">Not built yet.</p>
        )}
      </section>

      <section className="card">
        <h2>Personal links</h2>
        <p className="hint">
          Optional. Everyone can also use the main page. A personal link pre-fills their name.
        </p>
        <form className="row" onSubmit={createLink}>
          <input
            type="text"
            placeholder="Name, e.g. Aunty Jenny"
            value={linkName}
            onChange={(e) => setLinkName(e.target.value)}
            maxLength={80}
          />
          <button className="btn">Create &amp; copy link</button>
        </form>
        <ul className="list">
          {pending.map((p) => (
            <li key={p.id} className="row between">
              <span>{p.name}</span>
              <span className="row gap">
                <button className="btn small" onClick={() => copy(p.token)}>
                  {copied === p.token ? "Copied ✓" : "Copy link"}
                </button>
                <button className="btn small danger-o" onClick={() => removePending(p)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
