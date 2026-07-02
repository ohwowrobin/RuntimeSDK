# Korvayne Runtime - Runtime Integrity SDK for indie games

Korvayne Runtime is a small Windows x64 user-mode Runtime Integrity SDK for indie PC games. Ship one
DLL next to your game for baseline anti-cheat and anti-tamper sensors, or use the cooperative API
for protected gameplay values, protected save files, aim telemetry, studio event ingestion, and
startup/session context. It is free and MIT-licensed: clone or download it from GitHub, drop it in
with no license file and no server required, and it arms at full capability out of the box.

Honest scope: this is a user-mode client-integrity product. It raises the cost against memory
editors, trainers, injected DLLs, simple ESP/aim tooling, and low-effort tamper. It is not a kernel
anti-cheat and not a standalone ban oracle; correlate detections server-side and pair it with
server-authoritative validation for competitive multiplayer.

## What It Detects

- External memory readers/writers.
- Value tampering for game-registered health/ammo/cooldown-style values.
- Savegame file edits when the game uses the SaveGame protection API.
- Loader and manual-map code injection.
- IAT, inline, and ntdll hook shapes.
- Debugger/tamper tooling and insecure boot state signals.
- Self-protection failures.
- Advisory aim-snap, triggerbot, and wallhack signals from game-supplied per-shot telemetry.

## Runtime Features

- Configurable restore/eject and external-handle response policy through `anticheat.ini`.
- Typed ValueGuard exports: `AC_GuardFloat`, `AC_SetGuardedFloat`, `AC_GuardI32`,
  `AC_SetGuardedI32`, plus the raw U32 ABI.
- SaveGame protection exports: `AC_ProtectSaveBuffer/File` and `AC_VerifySaveBuffer/File`.
- Optional telemetry endpoint support for JSON detection events.
- Runtime identity/session context setters for player, session, platform, build, and game ID.
- Short-lived telemetry token setter: `AC_SetTelemetryToken` (used only if you run the optional backend).
- Optional startup context check and periodic recheck against a self-hosted backend.

## Endpoint Security

If you run the optional backend, client endpoints are public once shipped. Do not depend on a hidden
URL or a static secret in `anticheat.ini`. In production, issue a short-lived signed ingest token
from your own backend after login/platform verification, pass it with `AC_SetTelemetryToken(...)`,
and rate-limit/validate on the server by token, player, session, game ID, and build. Treat IP as
server-observed metadata, not as a client-controlled rate-limit escape hatch. Treat non-attested
client telemetry as review evidence; do not auto-ban from it unless your backend has a trusted
runtime/liveness proof.

## What's In This Package

```text
sdk/include/anticheat.h          public C API
sdk/bin/anticheat.dll            drop-in DLL + cooperative exports
sdk/lib/anticheat.lib            MSVC import library for anticheat.dll
sdk/anticheat.ini.example        sample configuration
backend-kit/                     schemas, OpenAPI, and endpoint templates (optional, self-hostable)
samples/ue5/                     Unreal Engine wrapper
samples/unity/                   Unity C# wrapper sample
README.md, CHANGELOG.md          documentation
LICENSE.txt                      MIT license
```

## Integration

- Drop-in: ship `anticheat.dll` and optional `anticheat.ini`, then load the DLL at startup. No
  license file is required. For protected online modes, fail closed if the DLL does not load.
- Config: copy `sdk/anticheat.ini.example` to `anticheat.ini` next to the DLL and edit the keys
  (every setting is documented in the guides). An optional GUI config editor,
  **KorvayneConfigurator**, is available as a separate download.
- Cooperative: include `anticheat.h`, link `sdk/lib/anticheat.lib` with `AC_USE_DLL` or resolve
  exports dynamically, set context fields, register protected values, protect save payloads,
  and route detections to your backend.
- Optional backend: start from `backend-kit/` for JSON schemas, OpenAPI, Node/Express, and
  Cloudflare Worker examples if you want to self-host the analysis backend.
- Signature updates: the SDK can consume a signed detection-signature update channel. This is an
  optional, advanced feature; the SDK works fully without it.
- UE5: copy `samples/ue5/ACTGuard.*` into your Unreal project and wire it up per the sample.
- Unity: copy `samples/unity/Assets/Korvayne` into your project and use the C# wrapper sample.

## Before you ship your game

- Load the DLL early and **fail closed** if it does not load or `AC_Init` returns non-zero for a
  protected online mode.
- Start on report-only (`detection_only`), review what your players actually run, then raise
  enforcement (`eject`, Balanced/Strict) once you trust the signal.
- Correlate detections server-side; do not auto-ban from client telemetry alone.

Free and MIT-licensed. Contributions and issues welcome on GitHub.
