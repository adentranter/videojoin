"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useUploadThing } from "@/lib/uploadthing";
import { fmt } from "@/lib/format";
import TrimSlider from "./TrimSlider";

type Stage = "intro" | "ready" | "countdown" | "recording" | "review" | "uploading" | "done" | "error";

type Props = {
  token: string;
  initialName: string;
  alreadySubmitted: boolean;
  maxDuration: number;
  minDuration: number;
  targetMin: number;
  targetMax: number;
};

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

/** Matches UploadThing clip maxFileSize. Phone videos are often larger than 32MB. */
const MAX_FILE_BYTES = 128 * 1024 * 1024;

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      const d = v.duration;
      URL.revokeObjectURL(url);
      if (!Number.isFinite(d) || d <= 0) reject(new Error("Could not read that video."));
      else resolve(d);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file doesn't look like a playable video."));
    };
    v.src = url;
  });
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function cameraError(e: unknown): string {
  const name = (e as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "We couldn't access your camera and microphone. Please allow access in your browser and try again.";
  if (name === "NotFoundError") return "We couldn't find a camera on this device.";
  if (name === "NotReadableError") return "Your camera is being used by another app. Close it and try again.";
  return "Something went wrong starting the camera. Please try again.";
}

export default function Recorder({
  token,
  initialName,
  alreadySubmitted,
  maxDuration,
  minDuration,
  targetMin,
  targetMax,
}: Props) {
  const [stage, setStage] = useState<Stage>("intro");
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [name, setName] = useState(initialName);

  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [trim, setTrim] = useState<[number, number]>([0, 0]);
  const [playing, setPlaying] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [others, setOthers] = useState<{ name: string; at: string }[] | null>(null);
  const [fromFile, setFromFile] = useState(false);

  const liveRef = useRef<HTMLVideoElement>(null);
  const playbackRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const trimRef = useRef(trim);
  trimRef.current = trim;

  const { startUpload } = useUploadThing("clip", {
    onUploadProgress: (p) => setProgress(p),
  });

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Release camera + blob URL on unmount.
  useEffect(() => stopStream, [stopStream]);
  useEffect(() => () => void (blobUrl && URL.revokeObjectURL(blobUrl)), [blobUrl]);

  // Attach the live stream whenever a live preview is on screen.
  useEffect(() => {
    if (["ready", "countdown", "recording"].includes(stage) && liveRef.current && streamRef.current) {
      liveRef.current.srcObject = streamRef.current;
    }
  }, [stage]);

  async function enableCamera() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError(
        "This browser can't record video. If you opened the link inside another app (WhatsApp, Facebook, Messenger…), open it in Safari or Chrome instead.",
      );
      setStage("error");
      return;
    }
    try {
      stopStream();
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      setStage("ready");
    } catch (e) {
      setError(cameraError(e));
      setStage("error");
    }
  }

  function beginCountdown() {
    setStage("countdown");
    let n = 3;
    setCount(n);
    const t = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(t);
        startRecording();
      } else setCount(n);
    }, 1000);
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickMime();
    const rec = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 2_500_000,
      audioBitsPerSecond: 128_000,
    });
    chunksRef.current = [];
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    rec.onstop = () => {
      const seconds = Math.min(maxDuration, (performance.now() - startedAtRef.current) / 1000);
      const type = rec.mimeType || mimeType || "video/webm";
      const b = new Blob(chunksRef.current, { type });
      if (liveRef.current) liveRef.current.srcObject = null;
      stopStream();
      if (seconds < minDuration) {
        setError("That was too short, please record at least a second.");
        setStage("intro");
        return;
      }
      setFromFile(false);
      setBlob(b);
      setBlobUrl(URL.createObjectURL(b));
      setDuration(seconds);
      setTrim([0, seconds]);
      setPlaying(false);
      setPreviewReady(false);
      setStage("review");
    };
    recorderRef.current = rec;
    startedAtRef.current = performance.now();
    setElapsed(0);
    rec.start(500);
    setStage("recording");
  }

  // Recording timer + hard stop at the max duration.
  useEffect(() => {
    if (stage !== "recording") return;
    const t = setInterval(() => {
      const s = (performance.now() - startedAtRef.current) / 1000;
      setElapsed(Math.min(s, maxDuration));
      if (s >= maxDuration) stopRecording();
    }, 100);
    return () => clearInterval(t);
  }, [stage, maxDuration]);

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  // MediaRecorder WebM has no duration header, so Chrome reports Infinity and seeking misbehaves.
  // Seeking far past the end makes the browser scan the file and work out the real duration.
  // Don't touch currentTime again until that has finished, or the element is left broken.
  function onPlaybackMetadata() {
    const v = playbackRef.current;
    if (!v) return;
    if (v.duration !== Infinity) {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        const d = v.duration;
        setDuration(d);
        setTrim(([s, e]) => {
          const start = Math.min(s, Math.max(0, d - minDuration));
          const end = Math.min(Math.max(e, start + minDuration), d);
          return [start, end];
        });
      }
      setPreviewReady(true);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      v.removeEventListener("durationchange", onDuration);
      if (Number.isFinite(v.duration) && v.duration > 0) {
        const d = Math.min(duration, v.duration);
        setDuration(d);
        setTrim(([s, e]) => [s, Math.min(e, d)]);
      }
      v.currentTime = 0;
      setPreviewReady(true);
    };
    const onDuration = () => {
      if (Number.isFinite(v.duration)) setTimeout(finish, 200);
    };
    const timeout = setTimeout(finish, 4000);
    v.addEventListener("durationchange", onDuration);
    v.currentTime = 1e101;
  }

  // Play only the trimmed range: loop guard on animation frames for precision.
  useEffect(() => {
    if (!playing) return;
    const v = playbackRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      const [s, e] = trimRef.current;
      if (v.currentTime >= e - 0.03 || v.ended) {
        v.pause();
        v.currentTime = s;
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  function togglePlay() {
    const v = playbackRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
      return;
    }
    const [s, e] = trim;
    if (v.currentTime < s || v.currentTime >= e - 0.05) v.currentTime = s;
    v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  function seek(t: number) {
    const v = playbackRef.current;
    if (!v || !previewReady) return;
    v.pause();
    setPlaying(false);
    v.currentTime = Math.max(0, t);
  }

  function tryAgain() {
    setBlob(null);
    setBlobUrl(null);
    setPlaying(false);
    setPreviewReady(false);
    setProgress(0);
    setError(null);
    if (fromFile) {
      setFromFile(false);
      setStage("intro");
      return;
    }
    void enableCamera();
  }

  async function onFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    const looksVideo =
      file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(file.name);
    if (!looksVideo) {
      setError("Please choose a video file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("That video is too large. Please choose one under 128 MB, or trim it first.");
      return;
    }

    try {
      const seconds = await readVideoDuration(file);
      if (seconds < minDuration) {
        setError("That was too short, please choose a video of at least a second.");
        return;
      }
      stopStream();
      setFromFile(true);
      setBlob(file);
      setBlobUrl(URL.createObjectURL(file));
      setDuration(seconds);
      setTrim([0, Math.min(seconds, maxDuration)]);
      setPlaying(false);
      setPreviewReady(false);
      setStage("review");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submit() {
    if (!blob) return;
    if (!name.trim()) {
      setError("Please add your name so they know who it's from.");
      return;
    }
    const length = trim[1] - trim[0];
    if (length > maxDuration) {
      setError(`Please trim your message to ${maxDuration} seconds or less.`);
      return;
    }
    setError(null);
    setProgress(0);
    setStage("uploading");
    try {
      const uploadFile =
        blob instanceof File
          ? blob
          : new File([blob], `clip.${blob.type.includes("mp4") ? "mp4" : "webm"}`, {
              type: blob.type.split(";")[0] || "video/webm",
            });
      const res = await startUpload([uploadFile], { token });
      const uploaded = res?.[0];
      if (!uploaded) throw new Error("Upload failed");
      const r = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          name: name.trim(),
          fileKey: uploaded.key,
          filename: uploaded.name,
          trimStart: Number(trim[0].toFixed(2)),
          trimEnd: Number(trim[1].toFixed(2)),
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Could not save your message");
      setStage("done");
    } catch (e) {
      setError(`${(e as Error).message}. Please check your connection and try again.`);
      setStage("review");
    }
  }

  // After submitting, show who else has sent a message (names + times only).
  useEffect(() => {
    if (stage !== "done") return;
    fetch("/api/submitted", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setOthers)
      .catch(() => setOthers(null));
  }, [stage]);

  // ---------- render ----------

  if (stage === "done") {
    return (
      <>
        <div className="card center">
          <h2>Thanks! Your message has been added ❤️</h2>
          <p>You can close this page now.</p>
        </div>
        {others && others.length > 0 && (
          <div className="card">
            <h2>
              {others.length} {others.length === 1 ? "person has" : "people have"} sent a message
            </h2>
            <ul className="list">
              {others.map((o, i) => (
                <li key={i} className="row between">
                  <span className="who">{o.name}</span>
                  <span className="dur">{whenLabel(o.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  }

  if (stage === "error") {
    return (
      <div className="card center">
        <p className="err">{error}</p>
        <button className="btn primary" onClick={() => setStage("intro")}>
          Try again
        </button>
      </div>
    );
  }

  if (stage === "intro") {
    return (
      <div className="card center">
        <p className="lead">Record a short video message.</p>
        <p>
          Aim for <strong>
            {targetMin}–{targetMax} seconds
          </strong>
          . You can record with your camera, or choose a video you already have. The message that gets
          saved can be at most {maxDuration} seconds.
        </p>
        {alreadySubmitted && (
          <p className="note">You&apos;ve already sent a message. Sending again will replace it.</p>
        )}
        {error && <p className="err">{error}</p>}
        <button className="btn primary big" onClick={enableCamera}>
          Turn on camera
        </button>
        <button className="btn big" type="button" onClick={() => fileInputRef.current?.click()}>
          Choose a video
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => void onFileChosen(e)}
        />
        <p className="hint">Recording uses your camera and microphone. Choosing a file uses one from your phone or computer.</p>
      </div>
    );
  }

  if (stage === "ready" || stage === "countdown" || stage === "recording") {
    return (
      <div className="card">
        <div className="stage">
          <video key="live" ref={liveRef} className="mirror" autoPlay muted playsInline />
          {stage === "countdown" && <div className="overlay big-count">{count}</div>}
          {stage === "recording" && (
            <div className="rec-badge">
              <span className="dot" /> {fmt(elapsed)} / {fmt(maxDuration)}
            </div>
          )}
        </div>
        {stage === "recording" && (
          <>
            <div className="bar zone">
              <span
                className="target"
                style={{ left: `${(targetMin / maxDuration) * 100}%`, width: `${((targetMax - targetMin) / maxDuration) * 100}%` }}
              />
              <div className={elapsed > targetMax ? "over" : ""} style={{ width: `${(elapsed / maxDuration) * 100}%` }} />
            </div>
            <p className={`nudge${elapsed > targetMax ? " warn" : ""}`}>
              {elapsed < targetMin
                ? `Aim for ${targetMin}–${targetMax} seconds`
                : elapsed <= targetMax
                  ? "Lovely, this is a great length 👍"
                  : `Time to wrap up! Recording stops at ${fmt(maxDuration)}`}
            </p>
          </>
        )}
        {stage === "ready" && (
          <p className="hint center">
            Aim for {targetMin}–{targetMax} seconds. It stops automatically at {maxDuration}.
          </p>
        )}
        <div className="row center">
          {stage === "ready" && (
            <button className="btn primary big" onClick={beginCountdown}>
              ● Record
            </button>
          )}
          {stage === "recording" && (
            <button className="btn danger big" onClick={stopRecording}>
              ■ Stop
            </button>
          )}
        </div>
      </div>
    );
  }

  // review + uploading
  const uploading = stage === "uploading";
  return (
    <div className="card">
      <div className="stage">
        {blobUrl && (
          <video
            key="playback"
            ref={playbackRef}
            src={blobUrl}
            playsInline
            preload="auto"
            onLoadedMetadata={onPlaybackMetadata}
            onClick={togglePlay}
          />
        )}
        {!previewReady && <div className="overlay preparing">Preparing preview…</div>}
        {previewReady && !playing && !uploading && (
          <button className="overlay play" onClick={togglePlay} aria-label="Replay">
            ▶
          </button>
        )}
      </div>

      <TrimSlider
        duration={duration}
        start={trim[0]}
        end={trim[1]}
        minGap={minDuration}
        onStart={(v) => {
          setTrim([v, trim[1]]);
          seek(v);
        }}
        onEnd={(v) => {
          setTrim([trim[0], v]);
          seek(v - 0.05);
        }}
      />

      {trim[1] - trim[0] > maxDuration ? (
        <p className="note">
          Please trim this to {maxDuration} seconds or less before sending.
        </p>
      ) : (
        trim[1] - trim[0] > targetMax && (
          <p className="note">
            That&apos;s a long one! Try trimming it to under {targetMax} seconds so everyone&apos;s message gets
            its moment.
          </p>
        )
      )}

      <label className="field">
        Your name
        <input
          type="text"
          value={name}
          maxLength={80}
          placeholder="e.g. Aunty Jenny"
          disabled={uploading}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      {error && <p className="err">{error}</p>}

      {uploading ? (
        <div>
          <div className="bar">
            <div style={{ width: `${progress}%` }} />
          </div>
          <p className="hint center">Uploading… {Math.round(progress)}%</p>
        </div>
      ) : (
        <div className="row">
          <button className="btn" onClick={tryAgain}>
            Try Again
          </button>
          <button
            className="btn primary"
            onClick={submit}
            disabled={trim[1] - trim[0] > maxDuration}
          >
            Use This Video
          </button>
        </div>
      )}
    </div>
  );
}
