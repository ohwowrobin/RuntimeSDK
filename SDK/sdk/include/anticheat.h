// ============================================================================
//  anticheat.h — Korvayne Runtime Integrity SDK (public C API).
// ----------------------------------------------------------------------------
//  A portable, in-process integrity + cheat-detection core for multiplayer
//  games. Engine-agnostic, Shipping-stable, clean C ABI (use from UE C++, native
//  C/C++, or via P/Invoke). Detection runs on a background thread; you receive
//  structured detections through a callback you route wherever you like.
//
//  Two integration modes (mix freely):
//    1. Drop-in    — ship anticheat.dll next to your game; it self-arms on load.
//                    Configure via anticheat.ini (no recompile). Zero code.
//    2. Cooperative — register the values you own (health/ammo/score), protect
//                    serialized save payloads, and report per-shot aim telemetry.
//
//  Link: define AC_USE_DLL to import from anticheat.dll and link the import
//  library, or resolve exports dynamically with GetProcAddress.
//
//  Security boundary: the game-local DLL path is not a trust proof by itself.
//  Production builds should ship a signed Korvayne DLL, fail closed if loading
//  or initialization fails, and use server-side token/liveness checks before
//  treating client detections as enforcement-grade evidence.
//
//  (c) 2026 Korvayne Solutions. Free and open source under the MIT License — see LICENSE.
// ============================================================================
#ifndef ANTICHEAT_H
#define ANTICHEAT_H

#ifdef __cplusplus
extern "C" {
#endif

#if defined(AC_USE_DLL)
#  define AC_API __declspec(dllimport)
#else
#  define AC_API
#endif

typedef enum {
    AC_SEV_INFO = 0,   // informational (e.g. "protection active")
    AC_SEV_LOW  = 1,   // weak/telemetry signal — log, don't act alone
    AC_SEV_MED  = 2,   // corroborating signal — review / correlate server-side
    AC_SEV_HIGH = 3,   // high-confidence tamper — actionable
    AC_SEV_CRIT = 4    // enforcement / eject
} ac_severity;

typedef struct {
    const char*        sensor;      // "Handle", "ValueGuard", "Module", "AimSnap", ...
    ac_severity        severity;
    float              confidence;  // 0.0 .. 1.0
    const char*        message;     // human-readable, already formatted
    unsigned long long detail;      // optional numeric (pid, access mask, address)
} ac_detection;

// Detection sink. Called from the SDK's background scan thread (NOT your game thread).
// Contract you must follow:
//   * det and its const char* fields (sensor, message) are valid ONLY for the duration of
//     this call. COPY anything you need to keep — do not store the pointers.
//   * Keep it cheap and non-blocking: no file/network I/O and no game-held locks on this
//     thread — a slow callback stalls scanning (and can trip the self-protection watchdog).
//   * Do NOT call any AC_* function from inside the callback (no reentrancy).
//   * Must be thread-safe. Route the (copied) data to your telemetry/backend — never to a
//     logger that is stripped from Shipping builds.
typedef void (*ac_detection_cb)(const ac_detection* det, void* user);

// Enforcement policy flags for ac_config.flags (combine with |). The callback is
// always invoked FIRST, so you can layer your own response (disconnect/kick) on
// top of — or instead of — these built-in policies.
#define AC_FLAG_VALUEGUARD_RESTORE  0x1u   // restore a guarded value on out-of-band write
#define AC_FLAG_TERMINATE_ON_TAMPER 0x2u   // terminate the host on a confirmed HIGH/CRIT detection
#define AC_FLAG_EJECT_ON_READER     0x4u   // also terminate on an unsigned external reader (ESP shape)

typedef struct {
    ac_detection_cb cb;               // required: where detections go
    void*           user;             // passed back to cb
    unsigned        scan_interval_ms; // sensor cadence (0 -> default 750ms)
    unsigned        flags;            // AC_FLAG_* enforcement options
    const char*     license;          // reserved / ignored (this open-source build has no
                                      // licensing; keep NULL). Kept for struct/ABI compatibility.
} ac_config;

// ---- Lifecycle ------------------------------------------------------------
// AC_Init arms every sensor + starts the background scan thread. Returns 0 on
// success, negative on error. Idempotent + safe to call early. (The drop-in DLL
// calls this for you on load; call it yourself when using the cooperative API to
// supply your own detection sink + enforcement flags.)
//   Return codes: 0 ok · -1 bad args · -2 thread start failed · -3 refused to arm.
// This open-source build has NO licensing and arms unconditionally at full capability.
// (-3 is only possible in a self-sign-enforced build whose own module is not validly
// code-signed.) Shipping games that require protection should still treat a non-zero
// AC_Init result or a missing DLL as "do not enter protected play".
AC_API int  AC_Init(const ac_config* cfg);
AC_API void AC_Tick(void);            // optional per-frame cheap checks
AC_API void AC_Shutdown(void);

// Runtime context used by structured telemetry and access-check requests.
// Values are copied by the SDK. They are non-secret client/game context; do not
// pass server secrets here.
AC_API void AC_SetGameId(const char* value);
AC_API void AC_SetEnvironment(const char* value);
AC_API void AC_SetIdentityProvider(const char* value);
AC_API void AC_SetPlayerId(const char* value);
AC_API void AC_SetSessionId(const char* value);
AC_API void AC_SetPlatformUserId(const char* value);
AC_API void AC_SetGameBuild(const char* value);
AC_API void AC_SetTelemetryToken(const char* value);

// ---- Cooperative value guard (address-keyed) ------------------------------
// Register any 4-byte value you own; the SDK keeps a per-session-keyed shadow and
// flags (and optionally restores) any write that did not go through the SDK.
AC_API void AC_GuardU32(const char* name, volatile unsigned* addr);  // register (e.g. BeginPlay)
AC_API void AC_NoteLegit(volatile unsigned* addr);                   // after a sanctioned write
AC_API void AC_Unguard(volatile unsigned* addr);                     // before the address dies
// PREFERRED: write-through setter — updates value AND shadow atomically, so a
// legit change can never desync (no false positive, no race).
AC_API void AC_SetGuardedU32(volatile unsigned* addr, unsigned val);

// Typed ValueGuard helpers. These are real DLL exports, implemented as thin
// wrappers over the stable 4-byte U32 core so integrators do not need to hand-roll
// casts or float bit-pattern conversion. Use SetGuarded* for every legitimate
// gameplay write. NoteLegit* is a fallback only after legacy direct writes.
// Public exports are callable by any code already injected into the game process;
// ValueGuard is therefore a tamper signal and local friction layer, not a
// standalone server ban proof.
AC_API void AC_GuardI32(const char* name, volatile int* addr);
AC_API void AC_NoteLegitI32(volatile int* addr);
AC_API void AC_UnguardI32(volatile int* addr);
AC_API void AC_SetGuardedI32(volatile int* addr, int val);
AC_API void AC_GuardFloat(const char* name, volatile float* addr);
AC_API void AC_NoteLegitFloat(volatile float* addr);
AC_API void AC_UnguardFloat(volatile float* addr);
AC_API void AC_SetGuardedFloat(volatile float* addr, float val);

// ---- Cooperative behavior hook (advisory) ---------------------------------
// Report game-supplied per-shot aim telemetry; the SDK runs aim-snap / triggerbot / wallhack
// heuristics. Advisory by design — best correlated server-side. Units are your
// game's; validate rollout against your own telemetry.
AC_API void AC_ReportAim(float aimSpeedPerMs, float reactionMs, int hadLineOfSight, int hit);

// ---- Cooperative SaveGame protection --------------------------------------
// The SDK does not decide how to serialize your game state. Pass the serialized
// bytes plus a stable context string, for example:
//   "player=<account-id>;slot=campaign-1;schema=2"
// Use the same context when verifying. Changing the context intentionally makes
// old protected saves fail verification, which prevents easy cross-player/slot
// copy attacks.
// Offline user-mode save protection raises the cost for casual save editors, but
// it is still a local sealing oracle. Server-authoritative inventory, currency,
// ranks, and multiplayer economy state must be validated by trusted backend code.
#define AC_SAVE_OK                0
#define AC_SAVE_BAD_ARGS         -1
#define AC_SAVE_BUFFER_TOO_SMALL -2
#define AC_SAVE_CRYPTO_FAILED    -3
#define AC_SAVE_TAMPERED         -4
#define AC_SAVE_IO_FAILED        -5
#define AC_SAVE_UNLICENSED       -6
#define AC_SAVE_DISABLED         -7
AC_API int AC_ProtectSaveBuffer(const void* plain, unsigned plain_len, const char* context,
                                void* out_protected, unsigned out_cap, unsigned* out_len);
AC_API int AC_VerifySaveBuffer(const void* protected_buf, unsigned protected_len, const char* context,
                               void* out_plain, unsigned out_cap, unsigned* out_len);
AC_API int AC_ProtectSaveFile(const char* path, const void* plain, unsigned plain_len, const char* context);
AC_API int AC_VerifySaveFile(const char* path, const char* context,
                             void* out_plain, unsigned out_cap, unsigned* out_len);
AC_API const char* AC_SaveResultName(int rc);

// Build/version string.
AC_API const char* AC_Version(void);

#ifdef __cplusplus
}
#endif

#endif // ANTICHEAT_H
