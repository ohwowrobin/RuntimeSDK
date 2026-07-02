import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import worker from "../worker.js";

function signToken(secret, payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function accessBody() {
  return {
    request_type: "access_check",
    sdk_version: "acsdk-test",
    client_side_only: false,
    game_id: "game-a",
    player_id: "player-a",
    session_id: "session-a",
    game_build: "1.0.0"
  };
}

function telemetryBody(eventId = "evt-00000001") {
  return {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    severity: "medium",
    category: "handle_checks",
    sensor: "Handle",
    detection: "Handle",
    confidence: 0.8,
    detail: 42,
    message: "test event",
    game_id: "game-a",
    player_id: "player-a",
    session_id: "session-a",
    game_build: "1.0.0",
    client_sends_ip: false
  };
}

function post(path, token, body) {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function makeD1() {
  const keys = new Set();
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (sql.startsWith("INSERT INTO korvayne_replay")) {
                if (keys.has(args[0])) throw new Error("UNIQUE constraint failed: korvayne_replay.event_key");
                keys.add(args[0]);
              }
              return { success: true };
            }
          };
        }
      };
    }
  };
}

test("scope-only access tokens are rejected", async () => {
  const secret = crypto.randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const token = signToken(secret, {
    jti: "scope-only",
    scope: ["access"],
    iat: now,
    exp: now + 300
  });

  const res = await worker.fetch(post("/anti-cheat/access-check", token, accessBody()), {
    KORVAYNE_TOKEN_SECRET: secret
  });

  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { allowed: false, reason_code: "invalid_identity" });
});

test("D1 replay store rejects duplicate telemetry event ids atomically", async () => {
  const secret = crypto.randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = telemetryBody();
  const token = signToken(secret, {
    jti: "telemetry-token",
    scope: ["telemetry"],
    game_id: body.game_id,
    player_id: body.player_id,
    session_id: body.session_id,
    game_build: body.game_build,
    iat: now,
    exp: now + 300
  });
  const env = { KORVAYNE_TOKEN_SECRET: secret, KORVAYNE_REPLAY_D1: makeD1() };

  let res = await worker.fetch(post("/anti-cheat/events", token, body), env);
  assert.equal(res.status, 202);

  res = await worker.fetch(post("/anti-cheat/events", token, body), env);
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "duplicate_event_id" });
});

test("KV replay binding is rejected instead of used for check-then-put replay protection", async () => {
  const secret = crypto.randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = telemetryBody("evt-00000002");
  const token = signToken(secret, {
    jti: "telemetry-token-kv",
    scope: ["telemetry"],
    game_id: body.game_id,
    player_id: body.player_id,
    session_id: body.session_id,
    game_build: body.game_build,
    iat: now,
    exp: now + 300
  });

  const res = await worker.fetch(post("/anti-cheat/events", token, body), {
    KORVAYNE_TOKEN_SECRET: secret,
    KORVAYNE_REPLAY_KV: { async get() {}, async put() {} }
  });

  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "nonatomic_replay_store" });
});
