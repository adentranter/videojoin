import { spawn } from "node:child_process";
import { createWriteStream, openAsBlob } from "node:fs";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  failBuild,
  finishBuild,
  getBuild,
  listSubmitted,
  setBuildProgress,
  type Submission,
} from "./db";
import { EVENT } from "./event";
import { utapi } from "./utapi";

// Every clip is re-encoded to exactly these parameters so the final concat can
// be a lossless stream copy no matter what phone/browser produced the source.
const W = 1280;
const H = 720;
const FPS = 30;

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.trim()}`)),
    );
  });
}

async function hasAudio(file: string): Promise<boolean> {
  const out = await run("ffprobe", [
    "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file,
  ]);
  return out.trim().length > 0;
}

async function download(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
}

async function normalize(src: string, dest: string, clip: Submission) {
  const start = Math.max(0, clip.trimStart ?? 0);
  const end = Math.max(start, clip.trimEnd ?? start + EVENT.maxDuration);
  // Cap extracted length, not absolute end — uploads may trim a window later than 30s.
  const dur = Math.max(0.5, Math.min(EVENT.maxDuration + 1, end - start));
  const audio = await hasAudio(src);

  const vf =
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${FPS},format=yuv420p`;
  const af = "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo";

  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", src];
  // Clips recorded without a mic still need an audio track so concat stays in sync.
  if (!audio) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  args.push(
    "-ss", start.toFixed(3),
    "-t", dur.toFixed(3),
    "-map", "0:v:0",
    "-map", audio ? "0:a:0" : "1:a:0",
    "-vf", vf,
    ...(audio ? ["-af", af] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-profile:v", "high", "-level", "4.0", "-r", String(FPS), "-g", String(FPS * 2),
    "-video_track_timescale", "90000",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    dest,
  );
  await run("ffmpeg", args);
}

/** Download, normalise and concatenate every clip. Returns the path of the final mp4 (inside `dir`). */
export async function buildFinalFile(
  clips: Submission[],
  dir: string,
  onProgress: (done: number) => Promise<unknown> | void = () => {},
): Promise<string> {
  const normalized: string[] = [];
  for (const [i, clip] of clips.entries()) {
    const src = join(dir, `src-${i}`);
    const out = join(dir, `clip-${String(i).padStart(4, "0")}.mp4`);
    try {
      await download(clip.fileUrl!, src);
      await normalize(src, out, clip);
    } catch (e) {
      throw new Error(`Clip ${i + 1} (${clip.name || clip.token}): ${(e as Error).message}`);
    }
    await rm(src, { force: true });
    normalized.push(out);
    await onProgress(i + 1);
  }

  const list = join(dir, "list.txt");
  await writeFile(list, normalized.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  const final = join(dir, EVENT.finalFilename);
  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", list,
    "-c", "copy", "-movflags", "+faststart", final,
  ]);
  return final;
}

export async function runBuild() {
  const dir = await mkdtemp(join(tmpdir(), "guestbook-"));
  try {
    const clips = await listSubmitted();
    if (clips.length === 0) throw new Error("No submissions to build.");

    const final = await buildFinalFile(clips, dir, setBuildProgress);

    const size = (await stat(final)).size;
    const file = new File([await openAsBlob(final)], EVENT.finalFilename, { type: "video/mp4" });
    const up = await utapi.uploadFiles(file);
    if (up.error) throw new Error(`Upload of final video (${size} bytes) failed: ${up.error.message}`);

    const prev = await getBuild();
    await finishBuild(up.data.key, up.data.ufsUrl, clips.length, clips.map((c) => c.id).join(","));
    if (prev.fileKey && prev.fileKey !== up.data.key) {
      await utapi.deleteFiles(prev.fileKey).catch(() => {});
    }
  } catch (e) {
    console.error("[build] failed", e);
    await failBuild((e as Error).message.slice(0, 1000));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
