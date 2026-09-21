# Video Guestbook (Mum & Dad's 50th)

Collect short video messages from lots of people, then compile them into one MP4.

Next.js · TypeScript · Postgres (`pg`, schema auto-created) · UploadThing (storage) · FFmpeg (server-side)

## Routes

| Route | What |
|---|---|
| `/` | Landing page. The button POSTs to `/api/start`, which mints a fresh unique link. |
| `/r/[token]` | Record → replay → trim → upload. Camera + `MediaRecorder`, 30s max. |
| `/admin` | Password-protected: preview / download / delete clips, build + download the final video, mint named personal links. |

## How the build works

`POST /api/admin/build` runs in the background of the Node process (state lives in the `build` table; the admin page polls it).
For each clip: download from UploadThing → trim → scale/pad to 1280×720 → 30fps → loudnorm + 48kHz stereo AAC →
H.264 (silent track added if the clip has no audio). All clips therefore share identical params, so the final
`concat` is a lossless stream copy. The result is uploaded to UploadThing and the old build is deleted.

## Env

See `.env.example`: `DATABASE_URL`, `UPLOADTHING_TOKEN`, `ADMIN_PASSWORD` (optional `SESSION_SECRET`).

## Local dev

```bash
pnpm install
cp .env.example .env.local   # fill in values
pnpm dev
```

Needs `ffmpeg`/`ffprobe` on PATH for the build step. Camera access needs HTTPS or `localhost`.

## Deploy (Coolify, same pattern as VibeTap)

1. Push to `github.com/adentranter/videojoin`; GitHub Actions publishes `ghcr.io/adentranter/videojoin:latest`.
2. Coolify: new **Docker image** app, port **3000**, healthcheck `GET /api/health`, set the env vars above.
3. Redeploy in Coolify after each image push.

Run a **single instance** for now: a build runs inside one container, so a second replica can't see its temp files.
The image needs enough RAM/CPU for FFmpeg (~1 core, a few hundred MB is fine at `veryfast`).
