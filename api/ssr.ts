import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createApp } from "../server/_core/index";

let appPromise: ReturnType<typeof createApp> | undefined;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  appPromise ??= createApp();
  const app = await appPromise;
  return app(req, res);
}
