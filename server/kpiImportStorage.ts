import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 180);

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Large-file storage is not configured: ${name} is required.`);
  return value;
};

function client() {
  const endpoint = process.env.KPI_S3_ENDPOINT;
  return new S3Client({
    region: process.env.KPI_S3_REGION || "auto",
    endpoint: endpoint || undefined,
    forcePathStyle: Boolean(endpoint),
    credentials: {
      accessKeyId: required("KPI_S3_ACCESS_KEY_ID"),
      secretAccessKey: required("KPI_S3_SECRET_ACCESS_KEY"),
    },
  });
}

const bucket = () => required("KPI_S3_BUCKET");
const prefix = () => (process.env.KPI_S3_PREFIX || "kpi-imports").replace(/^\/+|\/+$/g, "");

export const buildImportObjectKey = (importId: string, fileName: string) => `${prefix()}/${importId}/source/${safeName(fileName)}`;

export async function createImportUploadUrl(input: { importId: string; fileName: string; contentType: string }) {
  const key = buildImportObjectKey(input.importId, input.fileName);
  const command = new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: input.contentType });
  const uploadUrl = await getSignedUrl(client(), command, { expiresIn: 15 * 60 });
  return { key, uploadUrl, expiresInSeconds: 900 };
}

export async function getImportObjectInfo(key: string) {
  const result = await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
  return { bytes: Number(result.ContentLength ?? 0), contentType: result.ContentType || "application/octet-stream" };
}

export async function getImportObjectStream(key: string): Promise<Readable> {
  const result = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const body = result.Body;
  if (!body) throw new Error("The uploaded source file could not be read from object storage.");
  if (body instanceof Readable) return body;
  if (typeof (body as { transformToWebStream?: () => ReadableStream }).transformToWebStream === "function") {
    return Readable.fromWeb((body as { transformToWebStream: () => ReadableStream }).transformToWebStream() as never);
  }
  throw new Error("Object storage returned an unsupported response stream.");
}
