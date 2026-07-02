const textEncoder = new TextEncoder();
const rateBuckets = new Map();
const replayFallback = new Map();
const telemetryLiveness = new Map();
const MAX_BODY_BYTES = 64 * 1024;
const REQUIRED_CONTEXT_FIELDS = ["game_id", "player_id", "session_id", "game_build"];
const UNSAFE_TOKEN_SECRET_VALUES = new Set([
  "replace-with-at-least-32-random-bytes",
  "replace-or-remove",
  "change-me",
  "changeme",
  "placeholder",
  "development",
  "dev-secret",
  "test-secret"
]);
const SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);
const CATEGORIES = new Set([
  "injection",
  "hook_detection",
  "handle_checks",
  "debugger",
  "boot_state",
  "memory_integrity",
  "sdk_integrity",
  "protected_value",
  "savegame_integrity",
  "access_check",
  "aim_behavior",
  "enforcement",
  "unknown"
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function base64urlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function base64urlToString(value) {
  return new TextDecoder().decode(base64urlToBytes(value));
}

function bytesToBase64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, textEncoder.encode(data));
  return bytesToBase64url(new Uint8Array(sig));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearer(request) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : "";
}

function unsafeSecretReason(value) {
  const trimmed = String(value || "").trim();
  if (trimmed.length < 32) return "secret_too_short";
  if (UNSAFE_TOKEN_SECRET_VALUES.has(trimmed.toLowerCase())) return "placeholder_secret";
  if (/replace|placeholder|changeme|change-me|example/i.test(trimmed)) return "placeholder_secret";
  return "";
}

function configuredSecret(env) {
  const secret = env.KORVAYNE_TOKEN_SECRET || "";
  return unsafeSecretReason(secret) ? "" : secret;
}

async function verifyToken(request, env, requiredScope) {
  const secret = configuredSecret(env);
  if (!secret) return { ok: false, error: "endpoint_not_configured" };

  const token = bearer(request);
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, error: "missing_or_malformed_token" };

  const expected = await hmac(secret, parts[0]);
  if (!safeEqual(expected, parts[1])) return { ok: false, error: "invalid_token_signature" };

  let payload;
  try {
    payload = JSON.parse(base64urlToString(parts[0]));
  } catch {
    return { ok: false, error: "invalid_token_payload" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return { ok: false, error: "token_expired" };
  if (!payload.iat || payload.iat > now + 30) return { ok: false, error: "invalid_token_payload" };
  if (!payload.jti || String(payload.jti).length < 8) return { ok: false, error: "invalid_token_payload" };
  if (payload.nbf && payload.nbf > now + 30) return { ok: false, error: "token_not_yet_valid" };
  const scopes = Array.isArray(payload.scope) ? payload.scope : String(payload.scope || "").split(/\s+/);
  if (!scopes.includes(requiredScope)) return { ok: false, error: "token_scope_denied" };

  return { ok: true, payload, tokenId: payload.jti || token.slice(-24) };
}

function contextBindingError(body, payload) {
  for (const field of REQUIRED_CONTEXT_FIELDS) {
    if (!payload[field]) return `token_missing_${field}`;
    if (!body[field]) return `missing_${field}`;
    if (String(body[field]) !== String(payload[field])) return `mismatched_${field}`;
  }
  return "";
}

function runtimeTrustLevel(payload) {
  return payload.runtime_trust === "sdk_attested" || payload.sdk_attested === true
    ? "trusted_runtime"
    : "client_reported";
}

function trustedRuntimeRequired(env) {
  return env.KORVAYNE_REQUIRE_TRUSTED_RUNTIME === "1";
}

function recentTelemetryRequired(env) {
  return env.KORVAYNE_REQUIRE_RECENT_TELEMETRY === "1";
}

function livenessKey(payload) {
  return `${payload.game_id}:${payload.player_id}:${payload.session_id}:${payload.game_build}`;
}

function noteTelemetryLiveness(env, payload, trustLevel) {
  telemetryLiveness.set(livenessKey(payload), {
    seenAt: Date.now(),
    trustLevel,
    maxAgeMs: Number(env.KORVAYNE_RUNTIME_TELEMETRY_MAX_AGE_SEC || 300) * 1000
  });
}

function hasRecentTelemetry(env, payload) {
  const maxAgeMs = Number(env.KORVAYNE_RUNTIME_TELEMETRY_MAX_AGE_SEC || 300) * 1000;
  const now = Date.now();
  for (const [key, value] of telemetryLiveness) {
    if (now - value.seenAt > value.maxAgeMs) telemetryLiveness.delete(key);
  }
  const state = telemetryLiveness.get(livenessKey(payload));
  return !!state && now - state.seenAt <= maxAgeMs;
}

function rateLimit(key, limitPerMinute) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start >= 60000) {
    rateBuckets.set(key, { start: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limitPerMinute;
}

async function readJsonBody(request) {
  const len = Number(request.headers.get("content-length") || "0");
  if (len > MAX_BODY_BYTES) return { ok: false, status: 413, error: "request_too_large" };
  try {
    const text = await request.text();
    if (textEncoder.encode(text).byteLength > MAX_BODY_BYTES) {
      return { ok: false, status: 413, error: "request_too_large" };
    }
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}

async function markReplay(env, key) {
  const ttl = Number(env.REPLAY_TTL_SEC || 86400);
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;

  if (env.KORVAYNE_REPLAY_D1) {
    try {
      await env.KORVAYNE_REPLAY_D1
        .prepare("INSERT INTO korvayne_replay (event_key, expires_at) VALUES (?, ?)")
        .bind(key, expiresAt)
        .run();
      if (Math.random() < 0.01) {
        await env.KORVAYNE_REPLAY_D1
          .prepare("DELETE FROM korvayne_replay WHERE expires_at <= ?")
          .bind(Math.floor(Date.now() / 1000))
          .run();
      }
      return { ok: true, duplicate: false };
    } catch (err) {
      const message = String(err?.message || err).toLowerCase();
      if (message.includes("unique") || message.includes("constraint") || message.includes("primary key")) {
        return { ok: true, duplicate: true };
      }
      return { ok: false, status: 503, error: "replay_store_unavailable" };
    }
  }

  if (env.KORVAYNE_REPLAY_KV) {
    return { ok: false, status: 503, error: "nonatomic_replay_store" };
  }

  if (env.KORVAYNE_ALLOW_MEMORY_REPLAY !== "1") {
    return { ok: false, status: 503, error: "replay_store_required" };
  }

  const now = Date.now();
  for (const [id, expiresAt] of replayFallback) {
    if (expiresAt <= now) replayFallback.delete(id);
  }
  if (replayFallback.has(key)) return { ok: true, duplicate: true };
  replayFallback.set(key, now + ttl * 1000);
  return { ok: true, duplicate: false };
}

function boundedString(value, min, max, pattern) {
  if (typeof value !== "string" || value.length < min || value.length > max) return false;
  return pattern ? pattern.test(value) : true;
}

function optionalString(value, max, pattern) {
  if (value === undefined) return true;
  return boundedString(value, 0, max, pattern);
}

function validTelemetryEvent(body) {
  return body
    && boundedString(body.event_id, 8, 128, /^[A-Za-z0-9_.:-]+$/)
    && boundedString(body.timestamp, 10, 40)
    && SEVERITIES.has(body.severity)
    && CATEGORIES.has(body.category)
    && boundedString(body.sensor, 1, 64)
    && optionalString(body.detection, 64)
    && typeof body.confidence === "number"
    && body.confidence >= 0
    && body.confidence <= 1
    && typeof body.detail === "number"
    && body.detail >= 0
    && Number.isFinite(body.detail)
    && boundedString(body.message, 0, 1024)
    && optionalString(body.game_id, 96)
    && optionalString(body.environment, 32)
    && optionalString(body.identity_provider, 32)
    && optionalString(body.player_id, 128)
    && optionalString(body.session_id, 128)
    && optionalString(body.platform_user_id, 128)
    && optionalString(body.game_build, 64)
    && optionalString(body.license_id, 16, /^[a-fA-F0-9]{16}$/)
    && body.client_sends_ip !== true;
}

function validAccessCheck(body) {
  return body
    && body.request_type === "access_check"
    && boundedString(body.sdk_version, 1, 80)
    && typeof body.client_side_only === "boolean"
    && optionalString(body.game_id, 96)
    && optionalString(body.environment, 32)
    && optionalString(body.identity_provider, 32)
    && optionalString(body.player_id, 128)
    && optionalString(body.session_id, 128)
    && optionalString(body.platform_user_id, 128)
    && optionalString(body.game_build, 64)
    && optionalString(body.access_provider, 32)
    && optionalString(body.mode, 32)
    && optionalString(body.license_id, 16, /^[a-fA-F0-9]{16}$/);
}

async function handleTelemetry(request, env) {
  const auth = await verifyToken(request, env, "telemetry");
  if (!auth.ok) return json({ error: auth.error }, 401);

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body;
  if (!validTelemetryEvent(body)) return json({ error: "invalid_event_schema" }, 400);

  const bindingError = contextBindingError(body, auth.payload);
  if (bindingError) return json({ error: bindingError }, 401);

  const trustLevel = runtimeTrustLevel(auth.payload);
  if (trustedRuntimeRequired(env) && trustLevel !== "trusted_runtime") {
    return json({ error: "runtime_attestation_required" }, 403);
  }

  const rateKey = `evt:${auth.tokenId}:${auth.payload.game_id}:${auth.payload.player_id}:${auth.payload.session_id}`;
  if (!rateLimit(rateKey, Number(env.EVENT_RATE_LIMIT_PER_MIN || 120))) return json({ error: "rate_limited" }, 429);

  const replayKey = `${auth.payload.game_id}:${auth.payload.session_id}:${body.event_id}`;
  const replay = await markReplay(env, replayKey);
  if (!replay.ok) return json({ error: replay.error }, replay.status || 503);
  if (replay.duplicate) return json({ error: "duplicate_event_id" }, 409);

  const accepted = {
    received_at: new Date().toISOString(),
    token_id: auth.tokenId,
    event_source_trust: trustLevel,
    enforcement_eligible: trustLevel === "trusted_runtime",
    event: body
  };

  noteTelemetryLiveness(env, auth.payload, trustLevel);

  // Replace this with a Queue, R2 write, Logpush, or studio API call.
  console.log(JSON.stringify(accepted));
  return json({
    accepted: true,
    event_id: body.event_id,
    trust_level: trustLevel,
    enforcement_eligible: trustLevel === "trusted_runtime"
  }, 202);
}

async function handleAccessCheck(request, env) {
  const auth = await verifyToken(request, env, "access");
  if (!auth.ok) return json({ allowed: false, reason_code: "invalid_identity" }, 401);

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return json({ allowed: false, reason_code: "invalid_identity" }, parsed.status);
  const body = parsed.body;
  if (!validAccessCheck(body)) return json({ allowed: false, reason_code: "invalid_identity" }, 400);

  const bindingError = contextBindingError(body, auth.payload);
  if (bindingError) return json({ allowed: false, reason_code: "invalid_identity" }, 401);

  if (trustedRuntimeRequired(env) && runtimeTrustLevel(auth.payload) !== "trusted_runtime") {
    return json({ allowed: false, reason_code: "runtime_attestation_required" }, 403);
  }

  if (recentTelemetryRequired(env) && !hasRecentTelemetry(env, auth.payload)) {
    return json({ allowed: false, reason_code: "runtime_liveness_missing" }, 403);
  }

  const rateKey = `acc:${auth.tokenId}:${auth.payload.game_id}:${auth.payload.player_id}:${auth.payload.session_id}`;
  if (!rateLimit(rateKey, Number(env.ACCESS_RATE_LIMIT_PER_MIN || 30))) {
    return json({ allowed: false, reason_code: "rate_limited", retry_after_sec: 60 }, 429);
  }

  const banned = new Set(String(env.BANNED_PLAYER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean));
  const playerId = String(auth.payload.player_id);
  if (banned.has(playerId)) {
    return json({ allowed: false, reason_code: "active_ban", reason_public: "Access denied." });
  }

  return json({ allowed: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") return json({ ok: true });
    if (request.method === "POST" && url.pathname === "/anti-cheat/events") return handleTelemetry(request, env);
    if (request.method === "POST" && url.pathname === "/anti-cheat/access-check") return handleAccessCheck(request, env);
    return json({ error: "not_found" }, 404);
  }
};
