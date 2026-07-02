import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.join(__dirname, "..", "schemas");

const config = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || "development",
  tokenSecret: process.env.KORVAYNE_TOKEN_SECRET || "",
  eventRateLimit: Number(process.env.EVENT_RATE_LIMIT_PER_MIN || 120),
  accessRateLimit: Number(process.env.ACCESS_RATE_LIMIT_PER_MIN || 30),
  replayTtlMs: Number(process.env.REPLAY_TTL_SEC || 86400) * 1000,
  devAdminKey: process.env.DEV_ADMIN_KEY || "",
  enableDevSessionToken: process.env.ENABLE_DEV_SESSION_TOKEN === "1",
  allowMemoryReplay: process.env.KORVAYNE_ALLOW_MEMORY_REPLAY === "1",
  requireTrustedRuntime: process.env.KORVAYNE_REQUIRE_TRUSTED_RUNTIME === "1",
  requireRecentTelemetry: process.env.KORVAYNE_REQUIRE_RECENT_TELEMETRY === "1",
  runtimeTelemetryMaxAgeMs: Number(process.env.KORVAYNE_RUNTIME_TELEMETRY_MAX_AGE_SEC || 300) * 1000,
  bannedPlayers: new Set((process.env.BANNED_PLAYER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean))
};

const requiredContextFields = ["game_id", "player_id", "session_id", "game_build"];
const unsafeTokenSecretValues = new Set([
  "replace-with-at-least-32-random-bytes",
  "replace-or-remove",
  "change-me",
  "changeme",
  "placeholder",
  "development",
  "dev-secret",
  "test-secret"
]);

function unsafeTokenSecretReason(value) {
  const trimmed = String(value || "").trim();
  if (trimmed.length < 32) return "must be at least 32 bytes";
  if (unsafeTokenSecretValues.has(trimmed.toLowerCase())) return "must not use a public placeholder value";
  if (/replace|placeholder|changeme|change-me|example/i.test(trimmed)) return "must be a real random value, not an example string";
  return "";
}

const secretError = unsafeTokenSecretReason(config.tokenSecret);
if (secretError) {
  console.error(`KORVAYNE_TOKEN_SECRET ${secretError}.`);
  process.exit(1);
}

if (config.nodeEnv === "production" && !config.allowMemoryReplay) {
  console.error("Production mode requires a durable replay/rate store. Set KORVAYNE_ALLOW_MEMORY_REPLAY=1 only for an explicitly accepted small-scale deployment.");
  process.exit(1);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const telemetrySchema = JSON.parse(fs.readFileSync(path.join(schemaDir, "telemetry-event.schema.json"), "utf8"));
const accessSchema = JSON.parse(fs.readFileSync(path.join(schemaDir, "access-check-request.schema.json"), "utf8"));
const validateTelemetry = ajv.compile(telemetrySchema);
const validateAccess = ajv.compile(accessSchema);

const replayCache = new Map();
const rateBuckets = new Map();
const telemetryLiveness = new Map();

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function hmac(data) {
  return crypto.createHmac("sha256", config.tokenSecret).update(data).digest("base64url");
}

function signSessionToken(payload) {
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${hmac(encoded)}`;
}

function getBearer(req) {
  const header = req.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : "";
}

function verifySessionToken(req, requiredScope) {
  const token = getBearer(req);
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, status: 401, error: "missing_or_malformed_token" };

  const expected = hmac(parts[0]);
  const got = parts[1];
  const expectedBytes = Buffer.from(expected);
  const gotBytes = Buffer.from(got);
  if (expectedBytes.length !== gotBytes.length || !crypto.timingSafeEqual(expectedBytes, gotBytes)) {
    return { ok: false, status: 401, error: "invalid_token_signature" };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return { ok: false, status: 401, error: "invalid_token_payload" };
  }

  if (!payload.exp || payload.exp < nowSec()) return { ok: false, status: 401, error: "token_expired" };
  if (!payload.iat || payload.iat > nowSec() + 30) return { ok: false, status: 401, error: "invalid_token_payload" };
  if (!payload.jti || String(payload.jti).length < 8) return { ok: false, status: 401, error: "invalid_token_payload" };
  if (payload.nbf && payload.nbf > nowSec() + 30) return { ok: false, status: 401, error: "token_not_yet_valid" };

  const scopes = Array.isArray(payload.scope) ? payload.scope : String(payload.scope || "").split(/\s+/);
  if (!scopes.includes(requiredScope)) return { ok: false, status: 401, error: "token_scope_denied" };

  return { ok: true, payload, tokenId: payload.jti || token.slice(-24) };
}

function enforceContextBinding(body, tokenPayload) {
  for (const field of requiredContextFields) {
    if (!tokenPayload[field]) return `token_missing_${field}`;
    if (!body[field]) return `missing_${field}`;
    if (String(body[field]) !== String(tokenPayload[field])) return `mismatched_${field}`;
  }
  return "";
}

function rateLimit(key, limitPerMinute) {
  const windowMs = 60_000;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) {
    rateBuckets.set(key, { start: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limitPerMinute;
}

function markReplay(eventId) {
  const now = Date.now();
  for (const [id, expiresAt] of replayCache) {
    if (expiresAt <= now) replayCache.delete(id);
  }
  if (replayCache.has(eventId)) return false;
  replayCache.set(eventId, now + config.replayTtlMs);
  return true;
}

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function runtimeTrustLevel(payload) {
  return payload.runtime_trust === "sdk_attested" || payload.sdk_attested === true
    ? "trusted_runtime"
    : "client_reported";
}

function livenessKey(payload) {
  return `${payload.game_id}:${payload.player_id}:${payload.session_id}:${payload.game_build}`;
}

function noteTelemetryLiveness(payload, trustLevel) {
  telemetryLiveness.set(livenessKey(payload), {
    seenAt: Date.now(),
    trustLevel
  });
}

function hasRecentTelemetry(payload) {
  const now = Date.now();
  for (const [key, value] of telemetryLiveness) {
    if (now - value.seenAt > config.runtimeTelemetryMaxAgeMs) telemetryLiveness.delete(key);
  }
  const state = telemetryLiveness.get(livenessKey(payload));
  return !!state && now - state.seenAt <= config.runtimeTelemetryMaxAgeMs;
}

function acceptTelemetryEvent(event, auth, req, trustLevel) {
  const record = {
    received_at: new Date().toISOString(),
    ip_hash: crypto.createHash("sha256").update(clientIp(req)).digest("hex").slice(0, 16),
    token_id: auth.tokenId,
    event_source_trust: trustLevel,
    enforcement_eligible: trustLevel === "trusted_runtime",
    event
  };

  // Replace this with your queue, database, SIEM, Discord/Slack alert, or review pipeline.
  console.log(JSON.stringify(record));
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.post("/anti-cheat/events", (req, res) => {
  const auth = verifySessionToken(req, "telemetry");
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  if (!validateTelemetry(req.body)) {
    return res.status(400).json({ error: "invalid_event_schema", details: validateTelemetry.errors });
  }

  const bindingError = enforceContextBinding(req.body, auth.payload);
  if (bindingError) return res.status(401).json({ error: bindingError });

  const trustLevel = runtimeTrustLevel(auth.payload);
  if (config.requireTrustedRuntime && trustLevel !== "trusted_runtime") {
    return res.status(403).json({ error: "runtime_attestation_required" });
  }

  const rateKey = `evt:${auth.tokenId}:${auth.payload.game_id}:${auth.payload.player_id}:${auth.payload.session_id}`;
  if (!rateLimit(rateKey, config.eventRateLimit)) return res.status(429).json({ error: "rate_limited" });

  const replayKey = `${auth.payload.game_id}:${auth.payload.session_id}:${req.body.event_id}`;
  if (!markReplay(replayKey)) return res.status(409).json({ error: "duplicate_event_id" });

  noteTelemetryLiveness(auth.payload, trustLevel);
  acceptTelemetryEvent(req.body, auth, req, trustLevel);
  return res.status(202).json({
    accepted: true,
    event_id: req.body.event_id,
    trust_level: trustLevel,
    enforcement_eligible: trustLevel === "trusted_runtime"
  });
});

app.post("/anti-cheat/access-check", (req, res) => {
  const auth = verifySessionToken(req, "access");
  if (!auth.ok) return res.status(auth.status).json({ allowed: false, reason_code: "invalid_identity" });

  if (!validateAccess(req.body)) {
    return res.status(400).json({ allowed: false, reason_code: "invalid_identity" });
  }

  const bindingError = enforceContextBinding(req.body, auth.payload);
  if (bindingError) return res.status(401).json({ allowed: false, reason_code: "invalid_identity" });

  if (config.requireTrustedRuntime && runtimeTrustLevel(auth.payload) !== "trusted_runtime") {
    return res.status(403).json({ allowed: false, reason_code: "runtime_attestation_required" });
  }

  if (config.requireRecentTelemetry && !hasRecentTelemetry(auth.payload)) {
    return res.status(403).json({ allowed: false, reason_code: "runtime_liveness_missing" });
  }

  const rateKey = `acc:${auth.tokenId}:${auth.payload.game_id}:${auth.payload.player_id}:${auth.payload.session_id}`;
  if (!rateLimit(rateKey, config.accessRateLimit)) {
    return res.status(429).json({ allowed: false, reason_code: "rate_limited", retry_after_sec: 60 });
  }

  const playerId = String(auth.payload.player_id);
  if (config.bannedPlayers.has(playerId)) {
    return res.json({ allowed: false, reason_code: "active_ban", reason_public: "Access denied." });
  }

  return res.json({ allowed: true });
});

app.post("/dev/session-token", (req, res) => {
  if (config.nodeEnv === "production" || !config.enableDevSessionToken || !config.devAdminKey || req.get("x-dev-admin-key") !== config.devAdminKey) {
    return res.status(404).json({ error: "not_found" });
  }

  const ttlSec = Math.min(Number(req.body.ttl_sec || 900), 3600);
  const payload = {
    jti: crypto.randomUUID(),
    scope: req.body.scope || ["telemetry", "access"],
    game_id: String(req.body.game_id || "example-game"),
    player_id: String(req.body.player_id || "player_dev"),
    session_id: String(req.body.session_id || crypto.randomUUID()),
    game_build: String(req.body.game_build || "dev"),
    runtime_trust: req.body.runtime_trust === "sdk_attested" ? "sdk_attested" : "client_reported",
    iat: nowSec(),
    exp: nowSec() + ttlSec
  };

  res.json({ token: signSessionToken(payload), payload });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: "bad_request" });
});

app.listen(config.port, () => {
  console.log(`Korvayne Runtime endpoint listening on http://127.0.0.1:${config.port}`);
});
