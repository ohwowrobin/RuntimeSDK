// Copyright Epic Games, Inc. All Rights Reserved.
//
// ACTGuard - thin wrapper over anticheat.dll's cooperative value-guard API.
// The ACTGuardSubsystem resolves the DLL exports once at startup (Init); game
// code then calls these to protect values against external memory writes:
//   ACTGuard::GuardU32("health", (volatile unsigned*)&CurrentHP);  // register (BeginPlay)
//   ACTGuard::GuardFloat("health", &CurrentHP);                    // typed helper
//   ACTGuard::SetGuardedFloat(&CurrentHP, NewHP);                   // preferred legit write
//   ACTGuard::Unguard((volatile unsigned*)&CurrentHP);             // before destroy (EndPlay)
// Calls are no-ops if the DLL did not load, which is convenient for editor/dev.
// Shipping protected modes should call IsReady() after Init() and fail closed
// before matchmaking/server join if the runtime is unavailable.

#pragma once

namespace ACTGuard
{
	void Init(void* AcDllHandle);
	bool IsReady();
	void SetGameId(const char* Value);
	void SetEnvironment(const char* Value);
	void SetIdentityProvider(const char* Value);
	void SetPlayerId(const char* Value);
	void SetSessionId(const char* Value);
	void SetPlatformUserId(const char* Value);
	void SetGameBuild(const char* Value);
	void SetTelemetryToken(const char* Value);
	void GuardU32(const char* Name, volatile unsigned* Addr);    // register (BeginPlay)
	void NoteLegit(volatile unsigned* Addr);                     // after a legit change
	void SetGuardedU32(volatile unsigned* Addr, unsigned Val);   // PREFERRED: write-through (value+shadow atomic)
	void SetGuardedFloat(volatile float* Addr, float Val);       // PREFERRED for float-typed values (health/armor/stamina)
	void Unguard(volatile unsigned* Addr);                       // before destroy (EndPlay)
	void GuardI32(const char* Name, volatile int* Addr);
	void NoteLegitI32(volatile int* Addr);
	void SetGuardedI32(volatile int* Addr, int Val);
	void UnguardI32(volatile int* Addr);
	void GuardFloat(const char* Name, volatile float* Addr);
	void NoteLegitFloat(volatile float* Addr);
	void UnguardFloat(volatile float* Addr);
	// Behaviour hook: report game-supplied per-shot aim telemetry for advisory heuristics.
	void ReportAim(float AimSpeedPerMs, float ReactionMs, int HadLineOfSight, int Hit);
	// SaveGame protection: pass serialized save bytes plus a stable context such as
	// "player=<account-id>;slot=autosave;schema=1". Return 0 means ok.
	int ProtectSaveFile(const char* Path, const void* Plain, unsigned PlainLen, const char* Context);
	int VerifySaveFile(const char* Path, const char* Context, void* OutPlain, unsigned OutCap, unsigned* OutLen);
	const char* SaveResultName(int Result);
}
