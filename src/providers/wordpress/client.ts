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

/** Tri-state Yoast capability: the draft-based probe can be inconclusive. */
export type YoastMetaState = "supported" | "unsupported" | "unknown";

export interface CapabilityInfo {
  rest: boolean;
  yoastMeta: YoastMetaState;
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
  yoastFocusKw?: string;
  /**
   * From detectCapabilities(). Meta is sent when "supported" or "unknown"
   * (unknown = probe inconclusive; a WP-side rejection triggers the existing
   * safe retry without meta). Never sent when "unsupported".
   */
  yoastMeta: YoastMetaState;
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
    if (!rest) return { rest: false, yoastMeta: "unsupported" };
    const yoastMeta = await this.probeYoastMeta();
    return { rest: true, yoastMeta };
  }

  /**
   * Best-effort, read-only Yoast probe. Yoast SEO registers its
   * `_yoast_wpseo_*` fields with show_in_rest, which makes WordPress include a
   * `meta` object in edit-context post responses. The probe is tri-state:
   * "supported" when a draft exposes a `meta` object, "unsupported" when
   * drafts exist but none expose it, and "unknown" when the probe is
   * inconclusive (fetch failure or zero drafts — e.g. sites that publish
   * directly and never keep drafts). Callers attempt meta on "unknown";
   * createPost()/updatePost() still retry once without meta if the server
   * rejects it.
   */
  private async probeYoastMeta(): Promise<YoastMetaState> {
    let type: unknown;
    try {
      type = await this.getJson<unknown>("/wp-json/wp/v2/types/post");
    } catch {
      return "unknown";
    }
    const t = type as Record<string, unknown> | null;
    if (!t || typeof t !== "object") return "unknown";
    if (t["slug"] !== "post" && t["rest_base"] !== "posts") return "unsupported";

    let drafts: unknown;
    try {
      drafts = await this.getJson<unknown>(
        "/wp-json/wp/v2/posts?per_page=1&status=draft&context=edit"
      );
    } catch {
      return "unknown";
    }
    if (!Array.isArray(drafts) || drafts.length === 0) return "unknown";
    const meta = (drafts[0] as Record<string, unknown>)["meta"];
    return !!meta && typeof meta === "object" ? "supported" : "unsupported";
  }

  /** Find a category by case-insensitive exact name match, or create it.
   *
   * If the API user may not create categories (e.g. an author-role user),
   * fall back to the closest existing category by word overlap instead of
   * failing — callers stay non-blocking like the publish path. */
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
    try {
      const created = await this.postJson<{ id?: unknown }>("/wp-json/wp/v2/categories", {
        name: clean,
      });
      if (typeof created.id !== "number") {
        throw new WordPressError("INVALID_RESPONSE", "WordPress did not return a category id.");
      }
      return created.id;
    } catch (err) {
      if (!(err instanceof WordPressError) || (err.status !== 401 && err.status !== 403)) {
        throw err;
      }
      // This API user cannot create categories (403 rest_forbidden for author
      // role). Fall back to the closest existing category rather than
      // publishing uncategorized.
      const all = await this.getJson<Array<{ id?: unknown; name?: unknown }>>(
        "/wp-json/wp/v2/categories?per_page=100"
      );
      const fallback = this.closestCategory(clean, Array.isArray(all) ? all : []);
      if (fallback !== undefined) return fallback;
      throw err;
    }
  }

  /** Best word-overlap match to `name` among existing categories.
   * Returns undefined when nothing overlaps enough to trust. */
  private closestCategory(
    name: string,
    categories: Array<{ id?: unknown; name?: unknown }>
  ): number | undefined {
    const wanted = name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    if (wanted.length === 0) return undefined;
    let best: number | undefined;
    let bestOverlap = 0;
    for (const c of categories) {
      if (typeof c.id !== "number" || typeof c.name !== "string") continue;
      const have = new Set(
        c.name
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean)
      );
      let overlap = 0;
      for (const w of wanted) if (have.has(w)) overlap++;
      // Need at least half the words to match, and beat the current best.
      if (overlap > bestOverlap && overlap >= wanted.length / 2) {
        bestOverlap = overlap;
        best = c.id;
      }
    }
    return best;
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
   * Set the alt text on an uploaded media attachment.
   * Best-effort: throws WordPressError on failure so callers can decide
   * whether to treat it as blocking.
   */
  async setMediaAltText(mediaId: number, altText: string): Promise<void> {
    const res = await this.doFetch(`/wp-json/wp/v2/media/${mediaId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ alt_text: altText }),
    });
    if (!res.ok) throw await this.mappedHttpError(res, `/wp-json/wp/v2/media/${mediaId}`);
    await res.body?.cancel().catch(() => undefined);
  }

  /**
   * Create a post. Yoast meta is attempted when yoastMeta is "supported" or
   * "unknown" (probe inconclusive); if WordPress rejects the meta fields, it
   * retries once without meta and reports yoastApplied=false. A successful
   * meta send is verified by reading the post back. Never throws — failures
   * come back as ok:false.
   */
  async createPost(input: CreatePostInput): Promise<CreatePostResult> {
    const withMeta = input.yoastMeta !== "unsupported";
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
    let yoastApplied = body.metaSent;
    if (body.metaSent && input.yoastTitle) {
      yoastApplied = await this.verifyYoastApplied(created.id, input.yoastTitle, input.yoastDescription, input.yoastFocusKw);
    }
    return {
      ok: true,
      id: created.id,
      url: typeof created.link === "string" ? created.link : undefined,
      yoastApplied,
    };
  }

  /**
   * Update an existing post. Same input shape as createPost; only provided
   * fields are sent. Returns the updated post id/url.
   */
  async updatePost(
    postId: number,
    input: Partial<CreatePostInput> & { yoastMeta: YoastMetaState }
  ): Promise<CreatePostResult> {
    const withMeta = input.yoastMeta !== "unsupported";
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

  /** Move a post to trash. Returns ok:false with code on failure. */
  async deletePost(postId: number): Promise<{ ok: boolean; code?: string; message?: string }> {
    try {
      const res = await this.doFetch(`/wp-json/wp/v2/posts/${postId}`, { method: "DELETE" });
      if (!res.ok) {
        throw await this.mappedHttpError(res, `/wp-json/wp/v2/posts/${postId}`);
      }
      return { ok: true };
    } catch (err) {
      if (err instanceof WordPressError) {
        return { ok: false, code: err.code, message: err.message };
      }
      return { ok: false, code: "REQUEST_FAILED", message: "WordPress post deletion failed." };
    }
  }

  private async attemptUpdatePost(
    postId: number,
    input: Partial<CreatePostInput> & { yoastMeta: YoastMetaState },
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
    let yoastApplied = body.metaSent;
    if (body.metaSent && input.yoastTitle) {
      yoastApplied = await this.verifyYoastApplied(updated.id, input.yoastTitle, input.yoastDescription, input.yoastFocusKw);
    }
    return {
      ok: true,
      id: updated.id,
      url: typeof updated.link === "string" ? updated.link : undefined,
      yoastApplied,
    };
  }

  /** Raw meta-only update used by the verifier; never verifies (no recursion). */
  private async sendMetaUpdate(postId: number, yoastTitle: string, yoastDescription?: string, yoastFocusKw?: string): Promise<void> {
    const meta: Record<string, string> = { _yoast_wpseo_title: yoastTitle };
    if (yoastDescription) meta["_yoast_wpseo_metadesc"] = yoastDescription;
    if (yoastFocusKw) meta["_yoast_wpseo_focuskw"] = yoastFocusKw;
    await this.postJson<unknown>(`/wp-json/wp/v2/posts/${postId}`, { meta });
  }

  /**
   * Read back the post in edit context and confirm the Yoast title landed.
   * One corrective meta update + re-verify on mismatch. Never throws: any
   * verification failure returns false (publish itself is unaffected).
   */
  private async verifyYoastApplied(postId: number, yoastTitle: string, yoastDescription?: string, yoastFocusKw?: string): Promise<boolean> {
    const matches = async (): Promise<boolean> => {
      try {
        const post = await this.getJson<Record<string, unknown>>(`/wp-json/wp/v2/posts/${postId}?context=edit`);
        const meta = post?.["meta"];
        return !!meta && typeof meta === "object" &&
          (meta as Record<string, unknown>)["_yoast_wpseo_title"] === yoastTitle;
      } catch { return false; }
    };
    if (await matches()) return true;
    try { await this.sendMetaUpdate(postId, yoastTitle, yoastDescription, yoastFocusKw); }
    catch { return false; }
    return matches();
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
    if (input.yoastFocusKw) meta["_yoast_wpseo_focuskw"] = input.yoastFocusKw;
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
