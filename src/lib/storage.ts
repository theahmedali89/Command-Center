/**
 * Storage abstraction for media assets (Cloudflare R2, S3-compatible API).
 * Server-side only — never import from client components.
 *
 * R2 is the only provider in v1. If the R2 env vars are missing, every
 * operation throws a StorageError with code "NOT_CONFIGURED" so callers can
 * show an honest "not configured" state instead of faking success.
 */

import { createHash, createHmac } from "node:crypto";

export interface StorageUploadResult {
  /** Public URL where the asset can be served from. */
  url: string;
}

export interface StorageProvider {
  upload(
    key: string,
    data: Uint8Array,
    mimeType: string,
  ): Promise<StorageUploadResult>;
  delete(key: string): Promise<void>;
}

/** Error class whose `code` is machine-readable ("NOT_CONFIGURED" | "UPLOAD_FAILED" | "DELETE_FAILED"). */
export class StorageError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string | undefined;
}

function getR2Config(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new StorageError(
      "NOT_CONFIGURED",
      "Cloudflare R2 storage is not configured. Missing one or more of: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.",
    );
  }
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicUrl: process.env.R2_PUBLIC_URL || undefined,
  };
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * Encode a URL path per S3 SigV4 rules: each segment is encoded and the
 * segments are joined with literal slashes (S3 does not encode "/" in the
 * canonical URI). Characters encodeURIComponent leaves unescaped but S3
 * requires encoded ( ! ' ( ) * ) are percent-encoded too.
 */
function encodeS3Path(path: string): string {
  return path
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(/[!'()*]/g, (c) =>
        `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

interface SignedHeaders {
  authorization: string;
  amzDate: string;
  payloadHash: string;
}

/**
 * Minimal but correct AWS Signature Version 4 signing (R2 uses region
 * "auto" and service "s3"). Only the headers we actually send are signed.
 */
function signV4(opts: {
  method: string;
  url: string;
  accessKeyId: string;
  secretAccessKey: string;
  payloadHash: string;
  contentType?: string;
}): SignedHeaders {
  const parsed = new URL(opts.url);
  const host = parsed.host;
  // yyyymmdd'T'HHMMSS'Z' — strip the dashes/colons/milliseconds from ISO.
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = encodeS3Path(parsed.pathname);
  const canonicalQueryString = ""; // R2 object ops use no query params here.
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${opts.payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    opts.method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    opts.payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmacSha256(`AWS4${opts.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, "auto");
  const kService = hmacSha256(kRegion, "s3");
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = hmacSha256(kSigning, stringToSign).toString("hex");

  return {
    authorization:
      `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate,
    payloadHash: opts.payloadHash,
  };
}

/**
 * Cloudflare R2 storage over the S3-compatible API.
 * Throws StorageError{NOT_CONFIGURED} from the constructor when env is missing.
 */
export class R2Storage implements StorageProvider {
  private readonly config: R2Config;

  constructor() {
    this.config = getR2Config();
  }

  private objectUrl(key: string): string {
    const { accountId, bucket } = this.config;
    return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodeS3Path(key)}`;
  }

  async upload(
    key: string,
    data: Uint8Array,
    mimeType: string,
  ): Promise<StorageUploadResult> {
    const { accessKeyId, secretAccessKey, publicUrl } = this.config;
    const url = this.objectUrl(key);
    const body = Buffer.from(data);
    const payloadHash = sha256Hex(body);
    const signed = signV4({
      method: "PUT",
      url,
      accessKeyId,
      secretAccessKey,
      payloadHash,
      contentType: mimeType,
    });

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: signed.authorization,
        "x-amz-date": signed.amzDate,
        "x-amz-content-sha256": signed.payloadHash,
        "Content-Type": mimeType,
        "Content-Length": String(body.length),
      },
      body,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new StorageError(
        "UPLOAD_FAILED",
        `R2 upload failed (HTTP ${res.status}).${detail ? ` ${detail.slice(0, 300)}` : ""}`,
      );
    }

    return { url: publicUrl ? `${publicUrl}/${encodeS3Path(key)}` : url };
  }

  async delete(key: string): Promise<void> {
    const { accessKeyId, secretAccessKey } = this.config;
    const url = this.objectUrl(key);
    const payloadHash = sha256Hex("");
    const signed = signV4({
      method: "DELETE",
      url,
      accessKeyId,
      secretAccessKey,
      payloadHash,
    });

    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: signed.authorization,
        "x-amz-date": signed.amzDate,
        "x-amz-content-sha256": signed.payloadHash,
      },
    });

    // 404 on delete is fine — the object is already gone (idempotent delete).
    if (!res.ok && res.status !== 404) {
      const detail = await res.text().catch(() => "");
      throw new StorageError(
        "DELETE_FAILED",
        `R2 delete failed (HTTP ${res.status}).${detail ? ` ${detail.slice(0, 300)}` : ""}`,
      );
    }
  }
}

/**
 * Return the configured storage provider.
 * @throws StorageError with code "NOT_CONFIGURED" when R2 env vars are missing.
 */
export function getStorage(): StorageProvider {
  return new R2Storage();
}

/** True when thrown err is a StorageError (lets callers branch on err.code). */
export function isStorageError(err: unknown): err is StorageError {
  return err instanceof StorageError;
}
