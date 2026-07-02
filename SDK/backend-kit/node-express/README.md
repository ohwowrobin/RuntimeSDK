# Korvayne Runtime Node/Express Endpoint

Minimal studio-owned backend for direct-to-studio Korvayne telemetry and access checks.

## Run

```powershell
cd ".\backend-kit\node-express"
npm install
$env:KORVAYNE_TOKEN_SECRET = node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npm start
```

Configure the SDK:

```ini
[Telemetry]
enabled = 1
endpoint = https://your-game.example.com/anti-cheat/events
token_source = runtime_session_token

[AccessCheck]
enabled = 1
endpoint = https://your-game.example.com/anti-cheat/access-check
mode = startup_and_recheck
```

Telemetry and AccessCheck use the same configured auth header and runtime token. After your real
login/platform verification succeeds, your game backend should issue a short-lived session token and
the game should pass it to the SDK with `AC_SetTelemetryToken(...)`. Keep
`token_source = runtime_session_token` for production.

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

## Production Notes

- Keep `KORVAYNE_TOKEN_SECRET` only on the server.
- Leave `ENABLE_DEV_SESSION_TOKEN=0` and `DEV_ADMIN_KEY` empty outside local tests. The helper route
  also stays hidden when `NODE_ENV=production`.
- This small template uses in-memory rate/replay maps for development. `NODE_ENV=production` refuses
  to start unless you explicitly set `KORVAYNE_ALLOW_MEMORY_REPLAY=1`; replace the maps with Redis,
  D1, Postgres, or another shared store before real traffic.
- Bind tokens to `game_id`, `player_id`, `session_id`, and `game_build`.
- Verify Steam/Epic/platform identity before issuing a token.
- Treat accepted telemetry as `client_reported` unless the session token contains
  `runtime_trust: "sdk_attested"` from a server-side attestation flow. The template marks
  non-attested events as not enforcement-eligible.
- `KORVAYNE_REQUIRE_TRUSTED_RUNTIME=1` makes telemetry/access fail closed unless that trusted-runtime
  claim is present. `KORVAYNE_REQUIRE_RECENT_TELEMETRY=1` can additionally require a recent telemetry
  heartbeat before access-check approval.
- Store or forward accepted events to your own queue/log/review system.
- Enforce bans on your game server before matchmaking or server join.
