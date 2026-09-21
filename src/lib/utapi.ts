import { UTApi } from "uploadthing/server";

const globalForUt = globalThis as unknown as { utapi?: UTApi };
export const utapi = (globalForUt.utapi ??= new UTApi());
