// Copyright Epic Games, Inc. All Rights Reserved.

#include "ACTGuard.h"
#include "HAL/PlatformProcess.h"
#include <cstring>

namespace
{
	typedef void (*GuardU32_t)(const char*, volatile unsigned*);
	typedef void (*NoteLegit_t)(volatile unsigned*);
	typedef void (*SetGuarded_t)(volatile unsigned*, unsigned);
	typedef void (*Unguard_t)(volatile unsigned*);
	typedef void (*GuardI32_t)(const char*, volatile int*);
	typedef void (*NoteLegitI32_t)(volatile int*);
	typedef void (*SetGuardedI32_t)(volatile int*, int);
	typedef void (*UnguardI32_t)(volatile int*);
	typedef void (*GuardFloat_t)(const char*, volatile float*);
	typedef void (*NoteLegitFloat_t)(volatile float*);
	typedef void (*SetGuardedFloat_t)(volatile float*, float);
	typedef void (*UnguardFloat_t)(volatile float*);
	typedef void (*ReportAim_t)(float, float, int, int);
	typedef void (*SetString_t)(const char*);
	typedef int (*ProtectSaveFile_t)(const char*, const void*, unsigned, const char*);
	typedef int (*VerifySaveFile_t)(const char*, const char*, void*, unsigned, unsigned*);
	typedef const char* (*SaveResultName_t)(int);

	GuardU32_t   GP_Guard   = nullptr;
	NoteLegit_t  GP_Note    = nullptr;
	SetGuarded_t GP_Set     = nullptr;
	Unguard_t    GP_Unguard = nullptr;
	GuardI32_t   GP_GuardI32 = nullptr;
	NoteLegitI32_t GP_NoteI32 = nullptr;
	SetGuardedI32_t GP_SetI32 = nullptr;
	UnguardI32_t GP_UnguardI32 = nullptr;
	GuardFloat_t GP_GuardFloat = nullptr;
	NoteLegitFloat_t GP_NoteFloat = nullptr;
	SetGuardedFloat_t GP_SetFloat = nullptr;
	UnguardFloat_t GP_UnguardFloat = nullptr;
	ReportAim_t  GP_Aim     = nullptr;
	SetString_t  GP_GameId  = nullptr;
	SetString_t  GP_Env     = nullptr;
	SetString_t  GP_Idp     = nullptr;
	SetString_t  GP_Player  = nullptr;
	SetString_t  GP_Session = nullptr;
	SetString_t  GP_Platform = nullptr;
	SetString_t  GP_Build   = nullptr;
	SetString_t  GP_Token   = nullptr;
	ProtectSaveFile_t GP_SaveProtect = nullptr;
	VerifySaveFile_t GP_SaveVerify = nullptr;
	SaveResultName_t GP_SaveName = nullptr;
}

namespace ACTGuard
{
	void Init(void* AcDllHandle)
	{
		if (!AcDllHandle)
		{
			return;
		}
		GP_Guard   = (GuardU32_t)   FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_GuardU32"));
		GP_Note    = (NoteLegit_t)  FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_NoteLegit"));
		GP_Set     = (SetGuarded_t) FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_SetGuardedU32"));
		GP_Unguard = (Unguard_t)    FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_Unguard"));
		GP_GuardI32 = (GuardI32_t) FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_GuardI32"));
		GP_NoteI32 = (NoteLegitI32_t) FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_NoteLegitI32"));
		GP_SetI32 = (SetGuardedI32_t) FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_SetGuardedI32"));
		GP_UnguardI32 = (UnguardI32_t) FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_UnguardI32"));
		GP_GuardFloat = (GuardFloat_t) FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_GuardFloat"));
		GP_NoteFloat = (NoteLegitFloat_t) FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_NoteLegitFloat"));
		GP_SetFloat = (SetGuardedFloat_t) FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_SetGuardedFloat"));
		GP_UnguardFloat = (UnguardFloat_t) FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_UnguardFloat"));
		GP_Aim     = (ReportAim_t)  FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_ReportAim"));
		GP_GameId  = (SetString_t)  FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_SetGameId"));
		GP_Env     = (SetString_t)  FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_SetEnvironment"));
		GP_Idp     = (SetString_t)  FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_SetIdentityProvider"));
		GP_Player  = (SetString_t)  FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_SetPlayerId"));
		GP_Session = (SetString_t)  FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_SetSessionId"));
		GP_Platform = (SetString_t) FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_SetPlatformUserId"));
		GP_Build   = (SetString_t)  FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_SetGameBuild"));
		GP_Token   = (SetString_t)  FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_SetTelemetryToken"));
		GP_SaveProtect = (ProtectSaveFile_t) FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_ProtectSaveFile"));
		GP_SaveVerify = (VerifySaveFile_t) FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_VerifySaveFile"));
		GP_SaveName = (SaveResultName_t) FPlatformProcess::GetDllExport(AcDllHandle, TEXT("AC_SaveResultName"));
	}

	bool IsReady()
	{
		return GP_GameId != nullptr || GP_Guard != nullptr || GP_Aim != nullptr || GP_SaveProtect != nullptr;
	}

	void SetGameId(const char* Value)                         { if (GP_GameId)  GP_GameId(Value); }
	void SetEnvironment(const char* Value)                    { if (GP_Env)     GP_Env(Value); }
	void SetIdentityProvider(const char* Value)               { if (GP_Idp)     GP_Idp(Value); }
	void SetPlayerId(const char* Value)                       { if (GP_Player)  GP_Player(Value); }
	void SetSessionId(const char* Value)                      { if (GP_Session) GP_Session(Value); }
	void SetPlatformUserId(const char* Value)                 { if (GP_Platform) GP_Platform(Value); }
	void SetGameBuild(const char* Value)                      { if (GP_Build)   GP_Build(Value); }
	void SetTelemetryToken(const char* Value)                 { if (GP_Token)   GP_Token(Value); }
	void GuardU32(const char* Name, volatile unsigned* Addr)   { if (GP_Guard)   GP_Guard(Name, Addr); }
	void NoteLegit(volatile unsigned* Addr)                    { if (GP_Note)    GP_Note(Addr); }
	void SetGuardedU32(volatile unsigned* Addr, unsigned Val)  { if (GP_Set)     GP_Set(Addr, Val); }
	void Unguard(volatile unsigned* Addr)                      { if (GP_Unguard) GP_Unguard(Addr); }
	void GuardI32(const char* Name, volatile int* Addr)        { if (GP_GuardI32) GP_GuardI32(Name, Addr); else if (GP_Guard) GP_Guard(Name, (volatile unsigned*)Addr); }
	void NoteLegitI32(volatile int* Addr)                      { if (GP_NoteI32) GP_NoteI32(Addr); else if (GP_Note) GP_Note((volatile unsigned*)Addr); }
	void SetGuardedI32(volatile int* Addr, int Val)            { if (GP_SetI32) GP_SetI32(Addr, Val); else if (GP_Set) GP_Set((volatile unsigned*)Addr, (unsigned)Val); }
	void UnguardI32(volatile int* Addr)                        { if (GP_UnguardI32) GP_UnguardI32(Addr); else if (GP_Unguard) GP_Unguard((volatile unsigned*)Addr); }
	void GuardFloat(const char* Name, volatile float* Addr)    { if (GP_GuardFloat) GP_GuardFloat(Name, Addr); else if (GP_Guard) GP_Guard(Name, (volatile unsigned*)Addr); }
	void NoteLegitFloat(volatile float* Addr)                  { if (GP_NoteFloat) GP_NoteFloat(Addr); else if (GP_Note) GP_Note((volatile unsigned*)Addr); }
	void UnguardFloat(volatile float* Addr)                    { if (GP_UnguardFloat) GP_UnguardFloat(Addr); else if (GP_Unguard) GP_Unguard((volatile unsigned*)Addr); }

	// Write-through for float values: forward the float's exact bit pattern as a
	// u32 so the SDK's value+shadow stay atomic (no desync FP for legit changes).
	void SetGuardedFloat(volatile float* Addr, float Val)
	{
		if (GP_SetFloat)
		{
			GP_SetFloat(Addr, Val);
		}
		else if (GP_Set && Addr)
		{
			unsigned Bits = 0u;
			std::memcpy(&Bits, &Val, sizeof(Bits));
			GP_Set((volatile unsigned*)Addr, Bits);
		}
	}

	void ReportAim(float A, float R, int LOS, int Hit)         { if (GP_Aim)     GP_Aim(A, R, LOS, Hit); }
	int ProtectSaveFile(const char* Path, const void* Plain, unsigned PlainLen, const char* Context)
	{
		return GP_SaveProtect ? GP_SaveProtect(Path, Plain, PlainLen, Context) : -1;
	}
	int VerifySaveFile(const char* Path, const char* Context, void* OutPlain, unsigned OutCap, unsigned* OutLen)
	{
		return GP_SaveVerify ? GP_SaveVerify(Path, Context, OutPlain, OutCap, OutLen) : -1;
	}
	const char* SaveResultName(int Result)
	{
		return GP_SaveName ? GP_SaveName(Result) : "unavailable";
	}
}
