# Korvayne Runtime Cloudflare Worker Endpoint

Serverless direct-to-studio endpoint for Korvayne telemetry and access checks.

## Deploy Shape

Create Worker secrets:

```powershell
wrangler secret put KORVAYNE_TOKEN_SECRET
```

`KORVAYNE_TOKEN_SECRET` must be at least 32 bytes. If it is missing or shorter, the Worker rejects
all telemetry/access requests instead of accepting trivially signed tokens.

Optional test ban list:

```powershell
wrangler secret put BANNED_PLAYER_IDS
```

Recommended production binding:

- `KORVAYNE_REPLAY_D1`: D1 database with a unique replay table for `event_id` replay protection.
- A queue, R2 bucket, Logpush, or external API for accepted telemetry events.

Create the replay table:

```sql
CREATE TABLE IF NOT EXISTS korvayne_replay (
  event_key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
```

The Worker intentionally rejects `KORVAYNE_REPLAY_KV`. KV uses a non-atomic check-then-put shape for
this use case, which can allow duplicate events under race. Without D1, telemetry ingestion fails
closed with `replay_store_required` unless you explicitly set `KORVAYNE_ALLOW_MEMORY_REPLAY=1` for a
local/dev deployment. In-memory state is per Worker isolate and must not be treated as production
replay protection.

The template rejects requests above 64 KB, validates the same core fields as the JSON Schemas, and
fails closed when the token secret is not configured.

Optional hardening flags:

- `KORVAYNE_REQUIRE_TRUSTED_RUNTIME=1`: require session tokens to include
  `runtime_trust: "sdk_attested"` before accepting telemetry or access checks.
- `KORVAYNE_REQUIRE_RECENT_TELEMETRY=1`: require a recent telemetry heartbeat before allowing
  access-check approval.
- `KORVAYNE_RUNTIME_TELEMETRY_MAX_AGE_SEC`: max heartbeat age, default `300`.

Without the trusted-runtime claim, accepted events are logged as `client_reported` and
`enforcement_eligible: false`. Use that as review evidence, not as an automatic ban trigger.

## SDK Config

```ini
[Telemetry]
enabled = 1
endpoint = https://ac.your-game.example.com/anti-cheat/events
token_source = runtime_session_token

[AccessCheck]
enabled = 1
endpoint = https://ac.your-game.example.com/anti-cheat/access-check
mode = startup_and_recheck
```

Telemetry and AccessCheck use the same configured auth header and runtime token. Issue short-lived
session tokens from your real login backend and pass them to the SDK with
`AC_SetTelemetryToken(...)`. Keep `token_source = runtime_session_token` for production.

That runtime token comes from your own trusted backend, not from Korvayne automatically. Return it
with the normal login/session response after you have verified the player:

```json
{
  "player_id": "player_123",
  "session_id": "match_abc",
  "korvayne_token": "short-lived-token-created-by-your-server"
}
```

Then the game sets the same identity fields and token before telemetry or access checks run:

```c
AC_SetPlayerId(player_id);
AC_SetSessionId(session_id);
AC_SetTelemetryToken(korvayne_token);
```

If you select `mode = server_guidance_only`, the SDK will not call this access endpoint from the
client. Your trusted game/studio backend must then enforce bans before login, matchmaking, or server
join.
