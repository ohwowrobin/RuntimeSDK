# Korvayne Configurator

`KorvayneConfigurator.exe` is a small helper that creates or edits a plain-text `anticheat.ini`
so you don't have to hand-write config keys. It's a convenience — you can always edit
`anticheat.ini` directly.

**Requires the .NET 8+ Desktop Runtime** (https://dotnet.microsoft.com/download). The tool is tiny
(~230 KB) because it uses the shared runtime instead of bundling it. If you don't have .NET
installed, just copy `sdk/anticheat.ini.example` and edit it by hand — every key is documented in
the guides.

Export a preset without opening the UI:

```powershell
.\KorvayneConfigurator.exe --preset detection_only --output C:\Path\To\Game\anticheat.ini
.\KorvayneConfigurator.exe --preset balanced       --output C:\Path\To\Game\anticheat.ini
.\KorvayneConfigurator.exe --preset strict         --output C:\Path\To\Game\anticheat.ini
```

Presets (`detection_only`, `balanced`, `strict`) are starting points; the generated file still
contains every concrete key. Start on `detection_only`, then tighten once you trust the signal.

Save the generated `anticheat.ini` next to the protected game executable. It covers enforcement,
external-handle response, local logging, identity/runtime context, optional telemetry, telemetry
event/field selection, access checks, ValueGuard policy, and SaveGame protection policy.

Supported sections: `[Enforcement]`, `[Logging]`, `[Identity]`, `[Telemetry]`, `[TelemetryEvents]`,
`[TelemetryFields]`, `[AccessCheck]`, `[ValueGuard]`, `[SaveGameProtection]`. `[BanEnforcement]` is
guidance for your own game server, not a client-side security boundary.

**Never put server secrets in a shipped client config.** For production telemetry/access, use
`token_source = runtime_session_token`: your backend issues a short-lived session token after
login/platform verification and the game passes it with `AC_SetTelemetryToken(...)`. Any `auth_token`
stored in `anticheat.ini` is public — treat it as a local/dev fallback only. Endpoint examples live
in `..\backend-kit\`.
