let appPromise;

export default async function handler(req, res) {
  appPromise ??= import("../dist/index.js").then(({ createApp }) => createApp());
  const app = await appPromise;
  return app(req, res);
}
