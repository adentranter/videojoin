import { Pool } from "pg";
import { randomBytes } from "node:crypto";

const globalForPg = globalThis as unknown as { pool?: Pool; schema?: Promise<void> };

function pool(): Pool {
  if (!globalForPg.pool) {
    globalForPg.pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  }
  return globalForPg.pool;
}

const SCHEMA = `
create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  name text not null default '',
  filename text,
  file_key text,
  file_url text,
  trim_start real,
  trim_end real,
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);
create table if not exists build (
  id int primary key check (id = 1),
  status text not null default 'idle',
  done int not null default 0,
  total int not null default 0,
  error text,
  file_key text,
  file_url text,
  clip_count int,
  started_at timestamptz,
  finished_at timestamptz
);
insert into build (id) values (1) on conflict do nothing;
alter table submissions add column if not exists position int;
alter table build add column if not exists order_sig text;
`;

async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  globalForPg.schema ??= pool()
    .query(SCHEMA)
    .then(() => undefined)
    .catch((e) => {
      globalForPg.schema = undefined;
      throw e;
    });
  await globalForPg.schema;
  const res = await pool().query(text, params);
  return res.rows as T[];
}

export type Submission = {
  id: string;
  token: string;
  name: string;
  filename: string | null;
  fileKey: string | null;
  fileUrl: string | null;
  trimStart: number | null;
  trimEnd: number | null;
  createdAt: Date;
  submittedAt: Date | null;
};

type SubmissionRow = {
  id: string;
  token: string;
  name: string;
  filename: string | null;
  file_key: string | null;
  file_url: string | null;
  trim_start: number | null;
  trim_end: number | null;
  created_at: Date;
  submitted_at: Date | null;
};

const toSubmission = (r: SubmissionRow): Submission => ({
  id: r.id,
  token: r.token,
  name: r.name,
  filename: r.filename,
  fileKey: r.file_key,
  fileUrl: r.file_url,
  trimStart: r.trim_start,
  trimEnd: r.trim_end,
  createdAt: r.created_at,
  submittedAt: r.submitted_at,
});

export const newToken = () => randomBytes(9).toString("base64url");

export async function createSubmission(name = ""): Promise<Submission> {
  const rows = await q<SubmissionRow>(
    "insert into submissions (token, name) values ($1, $2) returning *",
    [newToken(), name],
  );
  return toSubmission(rows[0]);
}

export async function getByToken(token: string): Promise<Submission | null> {
  const rows = await q<SubmissionRow>("select * from submissions where token = $1", [token]);
  return rows[0] ? toSubmission(rows[0]) : null;
}

export async function getById(id: string): Promise<Submission | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await q<SubmissionRow>("select * from submissions where id = $1", [id]);
  return rows[0] ? toSubmission(rows[0]) : null;
}

/**
 * Submitted clips in final-video order: the admin's manual order first,
 * then anything not yet placed (new submissions) by submission time.
 */
export async function listSubmitted(): Promise<Submission[]> {
  const rows = await q<SubmissionRow>(
    "select * from submissions where file_key is not null order by position asc nulls last, submitted_at asc",
  );
  return rows.map(toSubmission);
}

/** Persist a manual order: ids[0] plays first. */
export async function setOrder(ids: string[]): Promise<void> {
  await q(
    `update submissions set position = t.ord - 1
       from unnest($1::uuid[]) with ordinality as t(id, ord)
      where submissions.id = t.id`,
    [ids],
  );
}

/** Links handed out that haven't recorded anything yet. */
export async function listPending(): Promise<Submission[]> {
  const rows = await q<SubmissionRow>(
    "select * from submissions where file_key is null and name <> '' order by created_at desc",
  );
  return rows.map(toSubmission);
}

export async function saveSubmission(
  token: string,
  v: { name: string; filename: string; fileKey: string; fileUrl: string; trimStart: number; trimEnd: number },
): Promise<{ replacedKey: string | null } | null> {
  const prev = await getByToken(token);
  if (!prev) return null;
  await q(
    `update submissions set name=$2, filename=$3, file_key=$4, file_url=$5,
       trim_start=$6, trim_end=$7, submitted_at=now() where token=$1`,
    [token, v.name, v.filename, v.fileKey, v.fileUrl, v.trimStart, v.trimEnd],
  );
  return { replacedKey: prev.fileKey && prev.fileKey !== v.fileKey ? prev.fileKey : null };
}

export async function deleteSubmission(id: string): Promise<Submission | null> {
  const rows = await q<SubmissionRow>("delete from submissions where id = $1 returning *", [id]);
  return rows[0] ? toSubmission(rows[0]) : null;
}

export type Build = {
  status: "idle" | "running" | "done" | "error";
  done: number;
  total: number;
  error: string | null;
  fileKey: string | null;
  fileUrl: string | null;
  clipCount: number | null;
  orderSig: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
};

type BuildRow = {
  status: Build["status"];
  done: number;
  total: number;
  error: string | null;
  file_key: string | null;
  file_url: string | null;
  clip_count: number | null;
  order_sig: string | null;
  started_at: Date | null;
  finished_at: Date | null;
};

const STALE_MS = 60 * 60 * 1000;

export async function getBuild(): Promise<Build> {
  const [r] = await q<BuildRow>("select * from build where id = 1");
  let status = r.status;
  // A container restart mid-build would leave "running" forever.
  if (status === "running" && r.started_at && Date.now() - r.started_at.getTime() > STALE_MS) {
    status = "error";
    r.error = "Build was interrupted (server restarted?). Try again.";
    await q("update build set status='error', error=$1 where id=1", [r.error]);
  }
  return {
    status,
    done: r.done,
    total: r.total,
    error: r.error,
    fileKey: r.file_key,
    fileUrl: r.file_url,
    clipCount: r.clip_count,
    orderSig: r.order_sig,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

/** Atomically claim the build slot. Returns false if one is already running. */
export async function startBuild(total: number): Promise<boolean> {
  await getBuild(); // clears a stale "running" state first
  const rows = await q(
    `update build set status='running', done=0, total=$1, error=null, started_at=now(), finished_at=null
     where id=1 and status <> 'running' returning id`,
    [total],
  );
  return rows.length > 0;
}

export const setBuildProgress = (done: number) => q("update build set done=$1 where id=1", [done]);

export const failBuild = (error: string) =>
  q("update build set status='error', error=$1, finished_at=now() where id=1", [error]);

export const finishBuild = (fileKey: string, fileUrl: string, clipCount: number, orderSig: string) =>
  q(
    `update build set status='done', file_key=$1, file_url=$2, clip_count=$3, order_sig=$4,
       finished_at=now(), error=null where id=1`,
    [fileKey, fileUrl, clipCount, orderSig],
  );
