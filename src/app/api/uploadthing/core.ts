import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { z } from "zod";
import { getByToken } from "@/lib/db";

const f = createUploadthing();

export const ourFileRouter = {
  clip: f({ video: { maxFileSize: "32MB", maxFileCount: 1 } })
    .input(z.object({ token: z.string().min(1).max(64) }))
    .middleware(async ({ input }) => {
      // Only holders of a valid recording link may upload.
      const sub = await getByToken(input.token);
      if (!sub) throw new UploadThingError("Invalid recording link");
      return { token: input.token };
    })
    // The client calls /api/submit after the upload, so nothing to do here.
    .onUploadComplete(async () => ({ ok: true })),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
