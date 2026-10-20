/**
 * Unit tests for WordPressClient. Zero network: every test injects fetchImpl.
 * Erasable TypeScript only (no enums) so it runs under `node --test`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WordPressClient, WordPressError } from "./client.ts";

interface Call {
  url: string;
  init?: RequestInit;
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Build a fetchImpl from a handler; records every call. */
function makeFetch(handler: Handler): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: unknown, init?: unknown) => {
    const url = String(input);
    calls.push({ url, init: init as RequestInit | undefined });
    return handler(url, init as RequestInit | undefined);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function authOf(call: Call): string | null {
  const headers = call.init?.headers as Record<string, string> | undefined;
  return headers?.["Authorization"] ?? headers?.["authorization"] ?? null;
}

async function bodyOf(call: Call): Promise<Record<string, unknown>> {
  const body = call.init?.body;
  assert.ok(typeof body === "string", "expected a JSON string body");
  return JSON.parse(body) as Record<string, unknown>;
}

const EXPECTED_AUTH = `Basic ${Buffer.from("editor:s3cret app password", "utf8").toString("base64")}`;

function clientFor(fetchImpl: typeof fetch): WordPressClient {
  return new WordPressClient({
    baseUrl: "https://example.com///",
    username: "editor",
    appPassword: "s3cret app password",
    fetchImpl,
  });
}

describe("WordPressClient", () => {
  it("verify() returns the user on success and normalizes the base URL", async () => {
    const { fetchImpl, calls } = makeFetch((url) => {
      assert.equal(url, "https://example.com/wp-json/wp/v2/users/me");
      return jsonResponse({ id: 3, name: "Site Editor", slug: "editor" });
    });
    const result = await clientFor(fetchImpl).verify();
    assert.equal(result.ok, true);
    assert.deepEqual(result.user, { id: 3, name: "Site Editor", slug: "editor" });
    assert.equal(calls.length, 1);
    assert.equal(authOf(calls[0]), EXPECTED_AUTH);
  });

  it("verify() maps 401 to AUTH_REQUIRED", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse(
        { code: "rest_not_logged_in", message: "You are not currently logged in." },
        401
      )
    );
    const result = await clientFor(fetchImpl).verify();
    assert.equal(result.ok, false);
    assert.equal(result.code, "AUTH_REQUIRED");
    assert.ok(result.message && !result.message.includes("s3cret"));
  });

  it("verify() maps a thrown fetch to NETWORK_ERROR", async () => {
    const { fetchImpl } = makeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const result = await clientFor(fetchImpl).verify();
    assert.equal(result.ok, false);
    assert.equal(result.code, "NETWORK_ERROR");
  });

  it("verify() maps 403 to BLOCKED", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ message: "Forbidden" }, 403));
    const result = await clientFor(fetchImpl).verify();
    assert.equal(result.ok, false);
    assert.equal(result.code, "BLOCKED");
  });

  it("detectCapabilities() maps 404 on /wp-json/ to NOT_CONFIGURED", async () => {
    const { fetchImpl } = makeFetch((url) => {
      assert.equal(url, "https://example.com/wp-json/");
      return new Response("Not Found", { status: 404 });
    });
    await assert.rejects(() => clientFor(fetchImpl).detectCapabilities(), (err: unknown) => {
      assert.ok(err instanceof WordPressError);
      assert.equal(err.code, "NOT_CONFIGURED");
      return true;
    });
  });

  it("detectCapabilities() maps an empty /wp-json/ body to NOT_CONFIGURED", async () => {
    const { fetchImpl } = makeFetch(() => new Response("", { status: 200 }));
    await assert.rejects(() => clientFor(fetchImpl).detectCapabilities(), (err: unknown) => {
      assert.ok(err instanceof WordPressError);
      assert.equal(err.code, "NOT_CONFIGURED");
      return true;
    });
  });

  it("detectCapabilities() reports unsupported when drafts exist but none expose meta", async () => {
    const { fetchImpl } = makeFetch((url) => {
      if (url === "https://example.com/wp-json/") {
        return jsonResponse({ namespaces: ["wp/v2", "oembed/1.0"] });
      }
      if (url === "https://example.com/wp-json/wp/v2/types/post") {
        return jsonResponse({ slug: "post", rest_base: "posts" });
      }
      if (url.startsWith("https://example.com/wp-json/wp/v2/posts?")) {
        return jsonResponse([{ id: 1, title: { rendered: "x" } }]); // no meta object
      }
      throw new Error(`unexpected url ${url}`);
    });
    const caps = await clientFor(fetchImpl).detectCapabilities();
    assert.deepEqual(caps, { rest: true, yoastMeta: "unsupported" });
  });

  it("detectCapabilities() reports unknown when the site has zero drafts", async () => {
    const { fetchImpl } = makeFetch((url) => {
      if (url === "https://example.com/wp-json/") {
        return jsonResponse({ namespaces: ["wp/v2"] });
      }
      if (url === "https://example.com/wp-json/wp/v2/types/post") {
        return jsonResponse({ slug: "post", rest_base: "posts" });
      }
      if (url.startsWith("https://example.com/wp-json/wp/v2/posts?")) {
        return jsonResponse([]); // inconclusive — not "unsupported"
      }
      throw new Error(`unexpected url ${url}`);
    });
    const caps = await clientFor(fetchImpl).detectCapabilities();
    assert.deepEqual(caps, { rest: true, yoastMeta: "unknown" });
  });

  it("detectCapabilities() detects Yoast when a draft exposes a meta object", async () => {
    const { fetchImpl } = makeFetch((url) => {
      if (url === "https://example.com/wp-json/") {
        return jsonResponse({ namespaces: ["wp/v2"] });
      }
      if (url === "https://example.com/wp-json/wp/v2/types/post") {
        return jsonResponse({ slug: "post", rest_base: "posts" });
      }
      return jsonResponse([{ id: 1, meta: { _yoast_wpseo_title: "t" } }]);
    });
    const caps = await clientFor(fetchImpl).detectCapabilities();
    assert.deepEqual(caps, { rest: true, yoastMeta: "supported" });
  });

  it("ensureCategory() returns the id of a case-insensitive exact match without POSTing", async () => {
    const { fetchImpl, calls } = makeFetch((url, init) => {
      assert.equal(init?.method, "GET");
      assert.ok(url.includes("/wp-json/wp/v2/categories?search=news"));
      return jsonResponse([
        { id: 4, name: "Newsletter" },
        { id: 5, name: "NEWS" },
      ]);
    });
    const id = await clientFor(fetchImpl).ensureCategory("news");
    assert.equal(id, 5);
    assert.equal(calls.length, 1);
  });

  it("ensureCategory() creates the category when no exact match exists", async () => {
    const { fetchImpl, calls } = makeFetch((url, init) => {
      if (init?.method === "GET") return jsonResponse([{ id: 4, name: "Newsletter" }]);
      assert.equal(url, "https://example.com/wp-json/wp/v2/categories");
      return jsonResponse({ id: 9, name: "News" }, 201);
    });
    const id = await clientFor(fetchImpl).ensureCategory("News");
    assert.equal(id, 9);
    assert.equal(calls.length, 2);
    assert.deepEqual(await bodyOf(calls[1]), { name: "News" });
  });

  it("ensureCategory() falls back to the closest existing category when creation is forbidden", async () => {
    const { fetchImpl, calls } = makeFetch((url, init) => {
      if (url === "https://example.com/wp-json/wp/v2/categories?per_page=100") {
        return jsonResponse([
          { id: 2, name: "Love, Family, Friendship & Emotions" },
          { id: 7, name: "Famous People Quotes" },
        ]);
      }
      if (init?.method === "GET") return jsonResponse([]);
      assert.equal(url, "https://example.com/wp-json/wp/v2/categories");
      return jsonResponse(
        { code: "rest_forbidden", message: "Sorry, you are not allowed to do that." },
        403
      );
    });
    const id = await clientFor(fetchImpl).ensureCategory("People Quotes");
    assert.equal(id, 7); // "people" + "quotes" both match
    assert.equal(calls.length, 3);
  });

  it("ensureCategory() rethrows when creation is forbidden and nothing overlaps", async () => {
    const { fetchImpl } = makeFetch((url, init) => {
      if (url === "https://example.com/wp-json/wp/v2/categories?per_page=100") {
        return jsonResponse([{ id: 2, name: "Love, Family, Friendship & Emotions" }]);
      }
      if (init?.method === "GET") return jsonResponse([]);
      return jsonResponse(
        { code: "rest_forbidden", message: "Sorry, you are not allowed to do that." },
        403
      );
    });
    await assert.rejects(() => clientFor(fetchImpl).ensureCategory("Celebrity & Author Quotes"), WordPressError);
  });

  it("ensureCategory() rethrows non-permission creation failures without fallback", async () => {
    const { fetchImpl, calls } = makeFetch((url, init) => {
      if (init?.method === "GET") return jsonResponse([]);
      return jsonResponse({ code: "rest_invalid", message: "Bad request." }, 400);
    });
    await assert.rejects(() => clientFor(fetchImpl).ensureCategory("News"), WordPressError);
    assert.equal(calls.length, 2); // no fallback list fetch on 400
  });

  it("uploadMedia() posts binary data with the right headers", async () => {
    const { fetchImpl, calls } = makeFetch((url, init) => {
      assert.equal(url, "https://example.com/wp-json/wp/v2/media");
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Content-Type"], "image/png");
      assert.equal(headers["Content-Disposition"], 'attachment; filename="pic.png_; evil"');
      assert.ok(init?.body instanceof Uint8Array);
      return jsonResponse({ id: 42, source_url: "https://example.com/pic.png" }, 201);
    });
    const out = await clientFor(fetchImpl).uploadMedia(
      new Uint8Array([1, 2, 3]),
      'pic.png"; evil',
      "image/png"
    );
    assert.deepEqual(out, { id: 42, url: "https://example.com/pic.png" });
    assert.equal(calls.length, 1);
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.ok(!headers["Content-Disposition"].includes('"evil'));
  });

  it("createPost() strips Yoast meta when yoastMeta is unsupported", async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ id: 11, link: "https://example.com/hello" }, 201)
    );
    const result = await clientFor(fetchImpl).createPost({
      title: "Hello",
      content: "<p>Hi</p>",
      status: "draft",
      categoryIds: [5],
      yoastTitle: "SEO title",
      yoastDescription: "SEO desc",
      yoastMeta: "unsupported",
    });
    assert.equal(result.ok, true);
    assert.equal(result.id, 11);
    assert.equal(result.url, "https://example.com/hello");
    assert.equal(result.yoastApplied, false);
    const sent = await bodyOf(calls[0]);
    assert.ok(!("meta" in sent), "meta must not be sent when unsupported");
    assert.deepEqual(sent["categories"], [5]);
  });

  it("createPost() sends meta and verifies it when yoastMeta is unknown", async () => {
    const { fetchImpl, calls } = makeFetch((url, init) => {
      if (init?.method === "GET") {
        assert.equal(url, "https://example.com/wp-json/wp/v2/posts/20?context=edit");
        return jsonResponse({ id: 20, meta: { _yoast_wpseo_title: "SEO" } });
      }
      return jsonResponse({ id: 20, link: "https://example.com/verify" }, 201);
    });
    const result = await clientFor(fetchImpl).createPost({
      title: "Verify",
      content: "<p>x</p>",
      status: "publish",
      yoastTitle: "SEO",
      yoastDescription: "SEO desc",
      yoastMeta: "unknown",
    });
    assert.equal(result.ok, true);
    assert.equal(result.yoastApplied, true);
    assert.equal(calls.length, 2);
    const sent = await bodyOf(calls[0]);
    assert.deepEqual(sent["meta"], {
      _yoast_wpseo_title: "SEO",
      _yoast_wpseo_metadesc: "SEO desc",
    });
  });

  it("createPost() corrects and re-verifies when the first read-back misses", async () => {
    let verifyCalls = 0;
    const { fetchImpl, calls } = makeFetch((url, init) => {
      if (url === "https://example.com/wp-json/wp/v2/posts") {
        return jsonResponse({ id: 21, link: "https://example.com/correct" }, 201);
      }
      if (url === "https://example.com/wp-json/wp/v2/posts/21?context=edit") {
        verifyCalls += 1;
        // First read-back: title missing (WP dropped it); second: present.
        return verifyCalls === 1
          ? jsonResponse({ id: 21, meta: {} })
          : jsonResponse({ id: 21, meta: { _yoast_wpseo_title: "SEO" } });
      }
      if (url === "https://example.com/wp-json/wp/v2/posts/21") {
        assert.equal(init?.method, "POST");
        return jsonResponse({ id: 21 });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const result = await clientFor(fetchImpl).createPost({
      title: "Correct",
      content: "<p>x</p>",
      status: "publish",
      yoastTitle: "SEO",
      yoastMeta: "supported",
    });
    assert.equal(result.ok, true);
    assert.equal(result.yoastApplied, true);
    const corrective = calls.find((c) => c.url === "https://example.com/wp-json/wp/v2/posts/21");
    assert.ok(corrective, "expected one corrective meta-only update");
    assert.deepEqual(await bodyOf(corrective), { meta: { _yoast_wpseo_title: "SEO" } });
  });

  it("createPost() retries once without meta when WP rejects the meta param", async () => {
    const { fetchImpl, calls } = makeFetch(() => {
      // makeFetch records the call before invoking the handler, so the first
      // request sees calls.length === 1.
      if (calls.length === 1) {
        return jsonResponse(
          { code: "rest_invalid_param", message: "Invalid parameter(s): meta" },
          400
        );
      }
      return jsonResponse({ id: 12, link: "https://example.com/retry" }, 201);
    });
    const client = clientFor(fetchImpl);
    const result = await client.createPost({
      title: "Retry",
      content: "<p>x</p>",
      status: "draft",
      yoastTitle: "SEO",
      yoastMeta: "supported",
    });
    assert.equal(result.ok, true);
    assert.equal(result.id, 12);
    assert.equal(result.yoastApplied, false);
    assert.equal(calls.length, 2);
    assert.ok("meta" in (await bodyOf(calls[0])), "first attempt sends meta");
    assert.ok(!("meta" in (await bodyOf(calls[1]))), "retry drops meta");
  });

  it("createPost() surfaces a non-meta failure without retrying", async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ code: "rest_cannot_create", message: "Sorry, you are not allowed." }, 403)
    );
    const result = await clientFor(fetchImpl).createPost({
      title: "Nope",
      content: "<p>x</p>",
      yoastMeta: "supported",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "BLOCKED");
    assert.equal(calls.length, 1);
  });

  it("never leaks credentials in error messages", async () => {
    const { fetchImpl } = makeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const result = await clientFor(fetchImpl).verify();
    assert.ok(result.message && !result.message.includes("s3cret"));
    assert.ok(result.message && !result.message.includes("editor"));
  });
});
