# Korvayne Runtime - Unity Wrapper

Korvayne Runtime is free and MIT-licensed. Clone or download it from
https://github.com/ohwowrobin/korvayne-latest. It drops in with no license file and no server, and
arms at full capability out of the box.

This sample is a thin C# wrapper over the native Windows x64 `anticheat.dll`. It is not a rewrite of
the anti-cheat core. The DLL still performs the detection work; Unity only loads it and calls the
cooperative API.

## Supported Target

- Unity Windows x86_64 player builds.
- The native SDK is Windows-only in this package.
- Editor play mode can load the DLL if it is placed where Unity can find it, but the real acceptance
  test is always a packaged Windows build.

## Files

```text
Assets/Korvayne/Scripts/Korvayne.cs                 P/Invoke wrapper.
Assets/Korvayne/Scripts/KorvayneManager.cs          Startup/context MonoBehaviour.
Assets/Korvayne/Scripts/KorvayneProtectedFloat.cs   ValueGuard float helper.
Assets/Korvayne/Scripts/KorvayneProtectedInt.cs     ValueGuard int helper.
Assets/Korvayne/Examples/KorvayneExamplePlayer.cs   Small usage example.
```

## Setup

1. Copy `samples/unity/Assets/Korvayne` into the Unity project's `Assets/` folder.
2. Add an empty GameObject to the first scene and attach `KorvayneManager`.
3. Set `gameId`, `environment`, `identityProvider`, and `gameBuild` in the Inspector.
4. Put `anticheat.dll` and `anticheat.ini` next to the packaged game executable.
5. Build a Windows x86_64 player and run it.

Important: Korvayne loads `anticheat.ini` and writes `anticheat.log` next to the host game
executable. Unity's native plugin folder is not the config location for the shipping player. After
building, copy `anticheat.dll` (and `anticheat.ini`) next to the final `.exe`.

For protected online play, call `KorvayneSdk.RequireReady()` during startup/login and block
matchmaking or server join if it throws. The softer `Load()` path is useful for editor testing, but a
shipping protected mode should not continue silently without the runtime.

## Runtime Context

After the player logs in, set the player/session context:

```csharp
KorvayneSdk.SetPlayerId(playerId);
KorvayneSdk.SetSessionId(sessionId);
KorvayneSdk.SetPlatformUserId(steamId);
KorvayneSdk.SetTelemetryToken(shortLivedTokenFromYourBackend);
```

or through the manager:

```csharp
KorvayneManager.Instance.SetPlayerContext(playerId, sessionId, steamId, shortLivedTokenFromYourBackend);
```

The telemetry token is only used if you run the optional, self-hostable analysis backend (see below).
Do not put backend secrets in Unity scripts, Resources, ScriptableObjects, or `anticheat.ini`.

## ValueGuard

Use the protected wrappers for values that cheaters like to edit:

```csharp
private KorvayneProtectedFloat health;
private KorvayneProtectedInt ammo;

void Start()
{
    health = new KorvayneProtectedFloat("player.health", 100f);
    ammo = new KorvayneProtectedInt("weapon.ammo", 30);
}

void TakeDamage(float amount)
{
    health.Set(Mathf.Max(0f, health.Get() - amount));
}

void Fire()
{
    if (ammo.Get() <= 0) return;
    ammo.Set(ammo.Get() - 1);
    KorvayneSdk.ReportAim(aimSpeedPerMs, reactionMs, hadLineOfSight, hit);
}

void OnDestroy()
{
    health?.Dispose();
    ammo?.Dispose();
}
```

The wrappers use unmanaged 4-byte memory on purpose. Do not guard ordinary C# fields directly; the
Unity/Mono/.NET garbage collector can move managed objects, while the SDK needs a stable address for
as long as the value is guarded.

Good first protected values:

- health
- ammo
- cooldowns
- damage/speed multipliers
- match score

Avoid values that change every frame, such as transform position, velocity, camera rotation, physics
state, and animation state.

## SaveGame Protection

Serialize your own save data first, then let Korvayne wrap it in a signed/obfuscated envelope. Use a
stable context string that includes the player/account ID, save slot, and schema version. The same
context must be used when loading.

```csharp
var context = $"player={playerId};slot=campaign-1;schema=2";
var path = Path.Combine(Application.persistentDataPath, "campaign-1.ksave");
var bytes = Encoding.UTF8.GetBytes(JsonUtility.ToJson(saveData));

var rc = KorvayneSdk.ProtectSaveFile(path, bytes, context);
if (rc != KorvayneSdk.SaveOk)
{
    Debug.LogWarning($"Save failed: {KorvayneSdk.SaveResultName(rc)}");
}

if (KorvayneSdk.TryVerifySaveFile(path, context, out var loadedBytes, out var loadRc))
{
    var json = Encoding.UTF8.GetString(loadedBytes);
    var loaded = JsonUtility.FromJson<MySaveData>(json);
}
else
{
    Debug.LogWarning($"Save rejected: {KorvayneSdk.SaveResultName(loadRc)}");
}
```

This catches casual save editors and file tampering. It is not DRM; a fully offline user-mode client
can still be patched by a determined reverser.

## Optional: Self-Hosted Analysis Backend

Korvayne runs fully on its own with no server. If you want centralized detection analysis, the SDK
ships an optional, self-hostable analysis backend you can run on your own infrastructure. When it is
configured, the client forwards telemetry (using the short-lived token from your backend) for
server-side correlation. This is advanced and entirely optional; the client arms at full capability
without it.

## Optional: Signature Update Channel

The SDK can pull signed detection-signature updates from an optional update channel so new detections
land without a rebuild. Signatures are cryptographically signed. This is an optional/advanced
convenience, not a requirement for the runtime to work.

## Scope and Honest Caveats

Korvayne Runtime is user-mode client integrity, not a kernel-level anti-cheat and not a standalone ban
oracle. Treat its detections as signals: correlate them server-side alongside your own gameplay
telemetry before acting. A determined reverser can patch any fully offline user-mode client.

## Common Problems

**`DllNotFoundException`**

The native DLL was not found by Unity. For packaged builds, put `anticheat.dll` next to the game's
`.exe`. For editor testing, also place it in a Unity native plugin location if needed.

**`BadImageFormatException`**

The build architecture is wrong. Use Windows x86_64.

**No `anticheat.log`**

The DLL probably was not loaded, local logging is disabled, or the files are not next to the actual
game executable.
