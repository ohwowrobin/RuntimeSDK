import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const serverPath = fileURLToPath(new URL("../server.js", import.meta.url));

function signToken(secret, payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

async function waitForServer(baseUrl, child) {
  for (let i = 0; i < 50; i += 1) {
    if (child.exitCode !== null) throw new Error("server exited before health check passed");
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) return;
    } catch {
      // Retry until the child process finishes startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become ready");
}

async function startServer(env = {}) {
  const port = 21000 + Math.floor(Math.random() * 20000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, NODE_ENV: "test", PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout.resume();

  try {
    await waitForServer(baseUrl, child);
  } catch (err) {
    child.kill();
    throw new Error(`${err.message}\n${stderr}`);
  }

  return {
    baseUrl,
    async stop() {
      if (child.exitCode === null) {
        child.kill();
        await once(child, "exit");
      }
    }
  };
}

test("public placeholder token secret is rejected at startup", async () => {
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: "0",
      KORVAYNE_TOKEN_SECRET: "replace-with-at-least-32-random-bytes"
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const [code] = await once(child, "exit");
  assert.notEqual(code, 0);
  assert.match(stderr, /placeholder|real random|public/i);
});

test("production mode refuses in-memory replay/rate state unless explicitly allowed", async () => {
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: "0",
      NODE_ENV: "production",
      KORVAYNE_TOKEN_SECRET: crypto.randomBytes(32).toString("base64url")
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const [code] = await once(child, "exit");
  assert.notEqual(code, 0);
  assert.match(stderr, /durable replay\/rate store/i);
});

test("access checks require token-bound identity and cannot rate-limit hop by spoofed headers", async () => {
  const secret = crypto.randomBytes(32).toString("base64url");
  const server = await startServer({
    KORVAYNE_TOKEN_SECRET: secret,
    ACCESS_RATE_LIMIT_PER_MIN: "1"
  });

  try {
    const now = Math.floor(Date.now() / 1000);
    const body = {
      request_type: "access_check",
      sdk_version: "acsdk-test",
      client_side_only: false,
      game_id: "game-a",
      player_id: "player-a",
      session_id: "session-a",
      game_build: "1.0.0"
    };

    const scopeOnly = signToken(secret, {
      jti: "scope-only",
      scope: ["access"],
      iat: now,
      exp: now + 300
    });

    let res = await fetch(`${server.baseUrl}/anti-cheat/access-check`, {
      method: "POST",
      headers: { authorization: `Bearer ${scopeOnly}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    assert.equal(res.status, 401);

    const valid = signToken(secret, {
      jti: "valid-access",
      scope: ["access"],
      game_id: body.game_id,
      player_id: body.player_id,
      session_id: body.session_id,
      game_build: body.game_build,
      iat: now,
      exp: now + 300
    });

    res = await fetch(`${server.baseUrl}/anti-cheat/access-check`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${valid}`,
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.10"
      },
      body: JSON.stringify(body)
    });
    assert.equal(res.status, 200);

    res = await fetch(`${server.baseUrl}/anti-cheat/access-check`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${valid}`,
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.25"
      },
      body: JSON.stringify(body)
    });
    assert.equal(res.status, 429);
  } finally {
    await server.stop();
  }
});

test("trusted runtime policy rejects unattested telemetry and access checks", async () => {
  const secret = crypto.randomBytes(32).toString("base64url");
  const server = await startServer({
    KORVAYNE_TOKEN_SECRET: secret,
    KORVAYNE_REQUIRE_TRUSTED_RUNTIME: "1"
  });

  try {
    const now = Math.floor(Date.now() / 1000);
    const basePayload = {
      scope: ["telemetry", "access"],
      game_id: "game-a",
      player_id: "player-a",
      session_id: "session-a",
      game_build: "1.0.0",
      iat: now,
      exp: now + 300
    };
    const event = {
      event_id: "evt-trust-1",
      timestamp: new Date().toISOString(),
      severity: "high",
      category: "injection",
      sensor: "Module",
      detection: "Module",
      confidence: 1,
      detail: 0,
      message: "test event",
      game_id: basePayload.game_id,
      player_id: basePayload.player_id,
      session_id: basePayload.session_id,
      game_build: basePayload.game_build,
      client_sends_ip: false
    };
    const accessBody = {
      request_type: "access_check",
      sdk_version: "acsdk-test",
      client_side_only: false,
      game_id: basePayload.game_id,
      player_id: basePayload.player_id,
      session_id: basePayload.session_id,
      game_build: basePayload.game_build
    };
    const unattested = signToken(secret, { ...basePayload, jti: "unattested-token" });
    const attested = signToken(secret, { ...basePayload, jti: "attested-token", runtime_trust: "sdk_attested" });

    let res = await fetch(`${server.baseUrl}/anti-cheat/events`, {
      method: "POST",
      headers: { authorization: `Bearer ${unattested}`, "content-type": "application/json" },
      body: JSON.stringify(event)
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "runtime_attestation_required");

    res = await fetch(`${server.baseUrl}/anti-cheat/access-check`, {
      method: "POST",
      headers: { authorization: `Bearer ${unattested}`, "content-type": "application/json" },
      body: JSON.stringify(accessBody)
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason_code, "runtime_attestation_required");

    res = await fetch(`${server.baseUrl}/anti-cheat/events`, {
      method: "POST",
      headers: { authorization: `Bearer ${attested}`, "content-type": "application/json" },
      body: JSON.stringify(event)
    });
    assert.equal(res.status, 202);
    const accepted = await res.json();
    assert.equal(accepted.trust_level, "trusted_runtime");
    assert.equal(accepted.enforcement_eligible, true);
  } finally {
    await server.stop();
  }
});

test("access checks can require recent SDK telemetry liveness", async () => {
  const secret = crypto.randomBytes(32).toString("base64url");
  const server = await startServer({
    KORVAYNE_TOKEN_SECRET: secret,
    KORVAYNE_REQUIRE_RECENT_TELEMETRY: "1"
  });

  try {
    const now = Math.floor(Date.now() / 1000);
    const tokenPayload = {
      jti: "liveness-token",
      scope: ["telemetry", "access"],
      game_id: "game-a",
      player_id: "player-a",
      session_id: "session-a",
      game_build: "1.0.0",
      iat: now,
      exp: now + 300
    };
    const token = signToken(secret, tokenPayload);
    const accessBody = {
      request_type: "access_check",
      sdk_version: "acsdk-test",
      client_side_only: false,
      game_id: tokenPayload.game_id,
      player_id: tokenPayload.player_id,
      session_id: tokenPayload.session_id,
      game_build: tokenPayload.game_build
    };

    let res = await fetch(`${server.baseUrl}/anti-cheat/access-check`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(accessBody)
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason_code, "runtime_liveness_missing");

    res = await fetch(`${server.baseUrl}/anti-cheat/events`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        event_id: "evt-live-1",
        timestamp: new Date().toISOString(),
        severity: "info",
        category: "sdk_integrity",
        sensor: "Runtime",
        detection: "Heartbeat",
        confidence: 1,
        detail: 0,
        message: "runtime heartbeat",
        game_id: tokenPayload.game_id,
        player_id: tokenPayload.player_id,
        session_id: tokenPayload.session_id,
        game_build: tokenPayload.game_build,
        client_sends_ip: false
      })
    });
    assert.equal(res.status, 202);

    res = await fetch(`${server.baseUrl}/anti-cheat/access-check`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(accessBody)
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).allowed, true);
  } finally {
    await server.stop();
  }
});
