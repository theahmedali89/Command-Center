/**
 * WordPress REST API client (Application Password auth).
 *
 * Talks to any WordPress site's REST API — never assumes capabilities,
 * never invents data, never includes secrets in error messages.
 */

export interface WordPressClientOptions {
  baseUrl: string;
  username: string;
  appPassword: string;
  /** Injectable for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export type WordPressErrorCode =
  | "AUTH_REQUIRED"
  | "BLOCKED"
  | "NOT_CONFIGURED"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "REQUEST_FAILED"
  | "EMPTY_UPDATE";

/** Error thrown for WordPress API failures. Messages are safe to surface. */
export class WordPressError extends Error {
  readonly code: WordPressErrorCode;
  readonly status?: number;
  /** Raw WP REST error code (e.g. "rest_invalid_param"), if the server sent one. */
  wpCode?: string;

  constructor(code: WordPressErrorCode, message: string, status?: number) {
    super(message);
    this.name = "WordPressError";
    this.code = code;
    this.status = status;
  }
}

export interface WordPressUser {
  id: number;
  name: string;
  slug: string;
}

export interface VerifyResult {
  ok: boolean;
  user?: WordPressUser;
  code?: WordPressErrorCode;
  message?: string;
}

export interface CapabilityInfo {
  rest: boolean;
  yoastMetaWritable: boolean;
}

export interface CreatePostInput {
  title: string;
  content: string;
  slug?: string;
  status?: "publish" | "draft" | "private";
  categoryIds?: number[];
  tagIds?: number[];
  featuredMediaId?: number;
  yoastTitle?: string;
  yoastDescription?: string;
  /** From detectCapabilities(). Meta is only sent when true. */
  yoastSupported: boolean;
}

export interface CreatePostResult {
  ok: boolean;
  id?: number;
  url?: string;
  yoastApplied?: boolean;
  code?: WordPressErrorCode;
  message?: string;
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_WP_MESSAGE_LENGTH = 300;

interface WpErrorBody {
  code?: unknown;
  message?: unknown;
}

export class WordPressClient {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly appPassword: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: WordPressClientOptions) {
    this.baseUrl = opts.baseUrl.trim().replace(/\/+$/, "");
    this.username = opts.username;
    this.appPassword = opts.appPassword;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Verify credentials via GET /wp-json/wp/v2/users/me. Never throws. */
  async verify(): Promise<VerifyResult> {
    try {
      const me = await this.getJson<{ id?: unknown; name?: unknown; slug?: unknown }>(
        "/wp-json/wp/v2/users/me"
      );
      if (typeof me.id !== "number" || typeof me.name !== "string") {
        return {
          ok: false,
          code: "INVALID_RESPONSE",
          message: "WordPress returned an unexpected response for the current user.",
        };
      }
      return {
        ok: true,
        user: { id: me.id, name: me.name, slug: typeof me.slug === "string" ? me.slug : "" },
      };
    } catch (err) {
      if (err instanceof WordPressError) {
        return { ok: false, code: err.code, message: err.message };
      }
      return { ok: false, code: "REQUEST_FAILED", message: "WordPress verification failed." };
    }
  }

  /**
   * Detect REST + Yoast meta writability. Throws WordPressError when the
   * site is unreachable or is not a WordPress REST endpoint.
   */
  async detectCapabilities(): Promise<CapabilityInfo> {
    const index = await this.getJson<unknown>("/wp-json/");
    const namespaces = (index as { namespaces?: unknown } | null)?.namespaces;
    const rest = Array.isArray(namespaces) && (namespaces as unknown[]).includes("wp/v2");
    if (!rest) return { rest: false, yoastMetaWritable: false };
    const yoastMetaWritable = await this.probeYoastMeta();
    return { rest: true, yoastMetaWritable };
  }

  /**
   * Best-effort, read-only Yoast probe. Yoast SEO registers its
   * `_yoast_wpseo_*` fields with show_in_rest, which makes WordPress include a
   * `meta` object in edit-context post responses. No drafts on the site means
   * the probe is inconclusive → false (never assume). createPost() still
   * retries once without meta if the server rejects it.
   */
  private async probeYoastMeta(): Promise<boolean> {
    let type: unknown;
    try {
      type = await this.getJson<unknown>("/wp-json/wp/v2/types/post");
    } catch {
      return false;
    }
    const t = type as Record<string, unknown> | null;
    if (!t || typeof t !== "object") return false;
    if (t["slug"] !== "post" && t["rest_base"] !== "posts") return false;

    let drafts: unknown;
    try {
      drafts = await this.getJson<unknown>(
        "/wp-json/wp/v2/posts?per_page=1&status=draft&context=edit"
      );
    } catch {
      return false;
    }
    if (!Array.isArray(drafts) || drafts.length === 0) return false;
    const meta = (drafts[0] as Record<string, unknown>)["meta"];
    return !!meta && typeof meta === "object";
  }

  /** Find a category by case-insensitive exact name match, or create it. */
  async ensureCategory(name: string): Promise<number> {
    const clean = name.trim();
    if (!clean) throw new WordPressError("REQUEST_FAILED", "Category name must not be empty.");
    const found = await this.getJson<Array<{ id?: unknown; name?: unknown }>>(
      `/wp-json/wp/v2/categories?search=${encodeURIComponent(clean)}&per_page=100`
    );
    if (Array.isArray(found)) {
      const match = found.find(
        (c) => typeof c.name === "string" && c.name.toLowerCase() === clean.toLowerCase()
      );
      if (match && typeof match.id === "number") return match.id;
    }
    const created = await this.postJson<{ id?: unknown }>("/wp-json/wp/v2/categories", {
      name: clean,
    });
    if (typeof created.id !== "number") {
      throw new WordPressError("INVALID_RESPONSE", "WordPress did not return a category id.");
    }
    return created.id;
  }

  /** Find a tag by case-insensitive exact name match, or create it. */
  async ensureTag(name: string): Promise<number> {
    const clean = name.trim();
    if (!clean) throw new WordPressError("REQUEST_FAILED", "Tag name must not be empty.");
    const found = await this.getJson<Array<{ id?: unknown; name?: unknown }>>(
      `/wp-json/wp/v2/tags?search=${encodeURIComponent(clean)}&per_page=100`
    );
    if (Array.isArray(found)) {
      const match = found.find(
        (t) => typeof t.name === "string" && t.name.toLowerCase() === clean.toLowerCase()
      );
      if (match && typeof match.id === "number") return match.id;
    }
    const created = await this.postJson<{ id?: unknown }>("/wp-json/wp/v2/tags", {
      name: clean,
    });
    if (typeof created.id !== "number") {
      throw new WordPressError("INVALID_RESPONSE", "WordPress did not return a tag id.");
    }
    return created.id;
  }

  /** Upload binary media. Returns the attachment id and its public URL. */
  async uploadMedia(
    data: Uint8Array,
    filename: string,
    mimeType: string
  ): Promise<{ id: number; url: string }> {
    const safeName =
      filename
        .replace(/["\\\r\n]/g, "_")
        .split(/[\\/]/)
        .pop() || "upload";
    const res = await this.doFetch("/wp-json/wp/v2/media", {
      method: "POST",
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${safeName}"`,
        Accept: "application/json",
      },
      // TS 5.7+ types Uint8Array generically over its buffer, which the DOM
      // BodyInit union doesn't accept; undici's fetch handles any Uint8Array
      // view correctly at runtime.
      body: data as unknown as BodyInit,
    });
    if (!res.ok) {
      throw await this.mappedHttpError(res, "/wp-json/wp/v2/media");
    }
    const created = await this.parseJsonBody<{ id?: unknown; source_url?: unknown }>(res);
    if (typeof created.id !== "number" || typeof created.source_url !== "string") {
      throw new WordPressError(
        "INVALID_RESPONSE",
        "WordPress did not return media details for the upload."
      );
    }
    return { id: created.id, url: created.source_url };
  }

  /**
   * Create a post. Yoast meta is sent ONLY when yoastSupported is true; if
   * WordPress rejects the meta fields, it retries once without meta and
   * reports yoastApplied=false. Never throws — failures come back as ok:false.
   */
  async createPost(input: CreatePostInput): Promise<CreatePostResult> {
    const withMeta = input.yoastSupported;
    try {
      return await this.attemptCreatePost(input, withMeta);
    } catch (err) {
      if (withMeta && err instanceof WordPressError && this.isMetaRejection(err)) {
        try {
          return await this.attemptCreatePost(input, false);
        } catch (retryErr) {
          return this.toFailedResult(retryErr);
        }
      }
      return this.toFailedResult(err);
    }
  }

  private async attemptCreatePost(
    input: CreatePostInput,
    includeMeta: boolean
  ): Promise<CreatePostResult> {
    const body = this.buildPostBody(input, includeMeta);
    const created = await this.postJson<{ id?: unknown; link?: unknown }>(
      "/wp-json/wp/v2/posts",
      body.body
    );
    if (typeof created.id !== "number") {
      throw new WordPressError("INVALID_RESPONSE", "WordPress did not return a post id.");
    }
    return {
      ok: true,
      id: created.id,
      url: typeof created.link === "string" ? created.link : undefined,
      yoastApplied: body.metaSent,
    };
  }

  /**
   * Update an existing post. Same input shape as createPost; only provided
   * fields are sent. Returns the updated post id/url.
   */
  async updatePost(
    postId: number,
    input: Partial<CreatePostInput> & { yoastSupported: boolean }
  ): Promise<CreatePostResult> {
    const withMeta = input.yoastSupported;
    try {
      return await this.attemptUpdatePost(postId, input, withMeta);
    } catch (err) {
      if (withMeta && err instanceof WordPressError && this.isMetaRejection(err)) {
        try {
          return await this.attemptUpdatePost(postId, input, false);
        } catch (retryErr) {
          return this.toFailedResult(retryErr);
        }
      }
      return this.toFailedResult(err);
    }
  }

  private async attemptUpdatePost(
    postId: number,
    input: Partial<CreatePostInput> & { yoastSupported: boolean },
    includeMeta: boolean
  ): Promise<CreatePostResult> {
    const body = this.buildPostBody(input, includeMeta);
    if (Object.keys(body.body).length === 0) {
      throw new WordPressError("EMPTY_UPDATE", "No fields to update.");
    }
    const updated = await this.postJson<{ id?: unknown; link?: unknown }>(
      `/wp-json/wp/v2/posts/${postId}`,
      body.body
    );
    if (typeof updated.id !== "number") {
      throw new WordPressError("INVALID_RESPONSE", "WordPress did not return a post id.");
    }
    return {
      ok: true,
      id: updated.id,
      url: typeof updated.link === "string" ? updated.link : undefined,
      yoastApplied: body.metaSent,
    };
  }

  /** Shared body builder for create/update. */
  private buildPostBody(
    input: Partial<CreatePostInput>,
    includeMeta: boolean
  ): { body: Record<string, unknown>; metaSent: boolean } {
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body["title"] = input.title;
    if (input.content !== undefined) body["content"] = input.content;
    if (input.status !== undefined) body["status"] = input.status;
    if (input.slug) body["slug"] = input.slug;
    if (input.categoryIds && input.categoryIds.length > 0) body["categories"] = input.categoryIds;
    if (input.tagIds && input.tagIds.length > 0) body["tags"] = input.tagIds;
    if (typeof input.featuredMediaId === "number") body["featured_media"] = input.featuredMediaId;

    const meta: Record<string, string> = {};
    if (input.yoastTitle) meta["_yoast_wpseo_title"] = input.yoastTitle;
    if (input.yoastDescription) meta["_yoast_wpseo_metadesc"] = input.yoastDescription;
    const metaSent = includeMeta && Object.keys(meta).length > 0;
    if (metaSent) body["meta"] = meta;
    return { body, metaSent };
  }

  /** True when WP rejected the request specifically because of the meta param. */
  private isMetaRejection(err: WordPressError): boolean {
    if (err.status !== 400 || err.wpCode !== "rest_invalid_param") return false;
    return /meta/i.test(err.message);
  }

  private toFailedResult(err: unknown): CreatePostResult {
    if (err instanceof WordPressError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return { ok: false, code: "REQUEST_FAILED", message: "WordPress post creation failed." };
  }

  // ---------- HTTP plumbing ----------

  private isIndexPath(path: string): boolean {
    return path === "/wp-json/" || path === "/wp-json";
  }

  private hostLabel(): string {
    try {
      return new URL(this.baseUrl).host;
    } catch {
      return "the WordPress site";
    }
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.username}:${this.appPassword}`, "utf8").toString("base64")}`;
  }

  private async doFetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = { Authorization: this.authHeader() };
    const extra = init?.headers;
    if (extra && typeof extra === "object" && !(extra instanceof Headers)) {
      Object.assign(headers, extra as Record<string, string>);
    }
    try {
      return await this.fetchImpl(url, {
        ...init,
        headers,
        signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Network-level failure (DNS, refused, timeout). Never leaks credentials.
      throw new WordPressError(
        "NETWORK_ERROR",
        `Could not reach ${this.hostLabel()}. Check the site URL and that the site is online.`
      );
    }
  }

  /** Map an HTTP error response to a safe WordPressError. */
  private async mappedHttpError(res: Response, path: string): Promise<WordPressError> {
    const status = res.status;
    if (status === 401) {
      return new WordPressError(
        "AUTH_REQUIRED",
        "WordPress rejected the credentials (HTTP 401). Check the username and application password.",
        status
      );
    }
    if (status === 403) {
      return new WordPressError(
        "BLOCKED",
        "WordPress refused the request (HTTP 403). The application password may lack permission, or the site may block REST access.",
        status
      );
    }
    const wpErr = await this.readWpErrorBody(res);
    if (this.isIndexPath(path)) {
      return new WordPressError(
        "NOT_CONFIGURED",
        "Not a WordPress site, or the REST API is disabled (could not reach /wp-json/).",
        status
      );
    }
    const detail = wpErr.message ? `: ${wpErr.message}` : ".";
    const err = new WordPressError(
      "REQUEST_FAILED",
      `WordPress request failed (HTTP ${status})${detail}`,
      status
    );
    if (wpErr.code) err.wpCode = wpErr.code;
    return err;
  }

  /** Read WP's {code, message} error body, truncated to a safe length. */
  private async readWpErrorBody(res: Response): Promise<{ code?: string; message?: string }> {
    try {
      const text = await res.text();
      if (!text.trim()) return {};
      const parsed = JSON.parse(text) as WpErrorBody;
      const out: { code?: string; message?: string } = {};
      if (typeof parsed.code === "string") out.code = parsed.code.slice(0, 80);
      if (typeof parsed.message === "string") {
        out.message = parsed.message.replace(/<[^>]*>/g, "").slice(0, MAX_WP_MESSAGE_LENGTH);
      }
      return out;
    } catch {
      return {};
    }
  }

  private async parseJsonBody<T>(res: Response): Promise<T> {
    const text = await res.text();
    if (!text.trim()) {
      throw new WordPressError("INVALID_RESPONSE", "WordPress returned an empty response.");
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new WordPressError(
        "INVALID_RESPONSE",
        "WordPress returned a response that is not valid JSON (the site may not be WordPress, or REST may be disabled)."
      );
    }
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.doFetch(path, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw await this.mappedHttpError(res, path);
    try {
      return await this.parseJsonBody<T>(res);
    } catch (err) {
      if (
        err instanceof WordPressError &&
        err.code === "INVALID_RESPONSE" &&
        this.isIndexPath(path)
      ) {
        throw new WordPressError(
          "NOT_CONFIGURED",
          "Not a WordPress site, or the REST API is disabled (the /wp-json/ response was not valid JSON).",
          res.status
        );
      }
      throw err;
    }
  }

  private async postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.doFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.mappedHttpError(res, path);
    return this.parseJsonBody<T>(res);
  }
}
