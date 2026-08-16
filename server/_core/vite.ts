import express, { type Express, type Request, type Response } from "express";
import fs from "node:fs";
import { type Server } from "node:http";
import { nanoid } from "nanoid";
import path from "node:path";
import superjson from "superjson";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";
import { DEFAULT_OG_IMAGE, SITE_DESCRIPTION, SITE_NAME, type RouteMeta } from "../../shared/seo";
import { buildSsrPrefetch } from "./ssrCaller";

const canonicalOrigin = (process.env.CANONICAL_ORIGIN || "https://willers-solution-beta.vercel.app").replace(/\/+$/, "");
const siteName = process.env.SITE_NAME || SITE_NAME;

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const compact = (value: string, length: number) => value.replace(/\s+/g, " ").trim().slice(0, length);

function buildHeadTags(head: RouteMeta): string {
  const title = escapeHtml(compact(head.title || siteName, 100));
  const description = escapeHtml(compact(head.description || SITE_DESCRIPTION, 200));
  const canonical = head.canonicalPath ? `${canonicalOrigin}${head.canonicalPath}` : "";
  const image = head.ogImage || DEFAULT_OG_IMAGE;
  const tags = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta property="og:type" content="${head.ogType || "website"}" />`,
    `<meta property="og:site_name" content="${escapeHtml(siteName)}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:locale" content="en_NG" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
  ];
  if (canonical) {
    tags.push(`<meta property="og:url" content="${escapeHtml(canonical)}" />`);
    tags.push(`<link rel="canonical" href="${escapeHtml(canonical)}" />`);
  }
  if (head.noindex || head.notFound) tags.push(`<meta name="robots" content="noindex, follow" />`);
  return tags.join("\n");
}

function composeHtml(template: string, html: string, head: RouteMeta, dehydratedState: unknown) {
  const serializedState = JSON.stringify(superjson.serialize(dehydratedState)).replace(/</g, "\\u003c");
  return template
    .replace("</body>", () => `<script>window.__RQ_STATE__ = ${serializedState}</script></body>`)
    .replace("<!--app-head-->", () => buildHeadTags(head))
    .replace("<!--app-html-->", () => html);
}

async function renderRequest(url: string, req: Request, res: Response, render: (url: string, prefetch: Awaited<ReturnType<typeof buildSsrPrefetch>>) => Promise<{ html: string; dehydratedState: unknown; head: RouteMeta }>) {
  const prefetch = await buildSsrPrefetch(req, res);
  return render(url, prefetch);
}

export async function setupVite(app: Express, server: Server) {
  const vite = await createViteServer({ ...viteConfig, configFile: false, server: { middlewareMode: true, hmr: { server }, allowedHosts: true }, appType: "custom" });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    try {
      let template = await fs.promises.readFile(path.resolve(process.cwd(), "client", "index.html"), "utf-8");
      template = template.replace('src="/src/entry-client.tsx"', `src="/src/entry-client.tsx?v=${nanoid()}"`);
      template = await vite.transformIndexHtml(req.originalUrl, template);
      template = template.replace("</head>", '<link rel="stylesheet" href="/src/index.css?direct" data-ssr-dev-css></head>');
      const { render } = await vite.ssrLoadModule("/src/entry-server.tsx");
      const result = await renderRequest(req.originalUrl, req, res, render);
      res.status(result.head.notFound ? 404 : 200).set("Cache-Control", "no-cache").type("html").end(composeHtml(template, result.html, result.head, result.dehydratedState));
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      console.error("[SSR] dev render failed:", error);
      next(error);
    }
  });
}

export function serveStatic(app: Express) {
  const publicDir = path.resolve(process.cwd(), "dist", "public");
  const serverEntry = path.resolve(process.cwd(), "dist", "server-ssr", "entry-server.js");
  const templatePath = path.join(publicDir, "index.html");

  app.use((req, res, next) => {
    if (req.path === "/index.html") return res.redirect(301, "/");
    if (req.path !== "/" && /\/+$/ .test(req.path)) {
      const query = req.originalUrl.slice(req.path.length);
      return res.redirect(301, `${req.path.replace(/\/+$/, "") || "/"}${query}`);
    }
    next();
  });
  app.use(express.static(publicDir, { index: false, redirect: false }));
  app.use("*", async (req, res) => {
    try {
      const [template, module] = await Promise.all([fs.promises.readFile(templatePath, "utf-8"), import(serverEntry)]);
      const result = await renderRequest(req.originalUrl, req, res, module.render);
      res.status(result.head.notFound ? 404 : 200).set("Cache-Control", "no-cache").type("html").end(composeHtml(template, result.html, result.head, result.dehydratedState));
    } catch (error) {
      console.error("[SSR] render failed, serving client shell:", error);
      const template = await fs.promises.readFile(templatePath, "utf-8");
      res.status(200).set("Cache-Control", "no-cache").type("html").end(template.replace("<!--app-head-->", () => buildHeadTags({ title: siteName, description: SITE_DESCRIPTION })).replace("<!--app-html-->", () => ""));
    }
  });
}
