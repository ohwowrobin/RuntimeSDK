# Changelog

Korvayne Runtime is free and MIT-licensed. Clone or download it from
https://github.com/ohwowrobin/korvayne-latest, drop the DLL in, and it arms at full capability
out of the box — no license file, no activation, no server required.

## Open-source release

- Korvayne Runtime is now free and MIT-licensed. All licensing, license-file loading, and online
  activation have been removed from the SDK; it arms at full capability with no key and no server.

## Detection & runtime

- Sensors: external read/write handles, manual-mapped PE images, newly-loaded unsigned modules,
  IAT/inline/ntdll hook shapes, debugger/tamper tooling, a self-protection watchdog, and insecure
  boot-state signals.
- Cooperative ValueGuard (address-keyed) with typed helpers: `AC_GuardI32`/`AC_SetGuardedI32`,
  `AC_GuardFloat`/`AC_SetGuardedFloat`, and the raw U32 ABI. Prefer the write-through setters.
- SaveGame protection: `AC_ProtectSaveBuffer/File`, `AC_VerifySaveBuffer/File`.
- Advisory aim heuristics (aim-snap / triggerbot / wallhack) from game-supplied per-shot telemetry.
- Runtime context setters for game, environment, identity provider, player, session, platform user,
  and build.
- `anticheat.ini` config: enforcement (`restore`, `eject`, `eject_on_reader`), logging, optional
  telemetry, access checks, ValueGuard, and SaveGame policy. Defaults to detection-only/report-only.

## Security & hardening

- Optional detection-signature verdicts are signed with a separate verdict key and verified offline
  against an embedded public key; a network attacker can't forge one. Unsigned/unreachable → ignored,
  and the SDK keeps running on built-in sensors (LAN/air-gapped installs unaffected).
- Requests to the optional self-hostable backend always use TLS regardless of port.
- `eject_on_reader` requires a second corroborating detection before terminating (overlays and
  capture tools produce the same read-only-handle shape).
- PE build uses Control Flow Guard, CET compatibility, ASLR/high-entropy/NX, and a version resource.
- Binaries are not code-signed by default; sign them yourself if your distribution channel requires it.

## Optional, self-hostable

- Signed `anticheat.sigs` deny-list update channel; missing, stale, or forged files are ignored and
  cannot weaken built-in sensors.
- Telemetry / access-check endpoints and an analysis backend you can self-host (`backend-kit/`).
  Nothing is required for normal startup — with no backend configured the SDK runs fully offline.

## Honest limits

- User-mode client integrity: not a kernel anti-cheat and not a standalone ban oracle. Correlate
  detections server-side and keep authoritative game state on your backend.
- `AC_Version()` reports `acsdk 0.1.4-runtime`; the DLL file/product version is `0.1.4.0`.
