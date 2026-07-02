using System;
using System.IO;
using System.Runtime.InteropServices;
using UnityEngine;

namespace Korvayne
{
    public enum KorvayneStatus
    {
        Unknown,
        Ready,
        MissingDll,
        Failed
    }

    public static class KorvayneSdk
    {
        private const string DllName = "anticheat";
        private static KorvayneStatus _status = KorvayneStatus.Unknown;
        private static string _version = "";

        public static KorvayneStatus Status => _status;
        public static string Version => _version;
        public static bool IsReady => _status == KorvayneStatus.Ready;
        public const int SaveOk = 0;
        public const int SaveTampered = -4;

        public static bool Load()
        {
            if (_status == KorvayneStatus.Ready)
            {
                return true;
            }

            try
            {
                IntPtr p = AC_Version();
                _version = p == IntPtr.Zero ? "" : Marshal.PtrToStringAnsi(p) ?? "";
                _status = KorvayneStatus.Ready;
                return true;
            }
            catch (DllNotFoundException ex)
            {
                _status = KorvayneStatus.MissingDll;
                Debug.LogWarning($"Korvayne Runtime DLL was not found: {ex.Message}");
                return false;
            }
            catch (BadImageFormatException ex)
            {
                _status = KorvayneStatus.Failed;
                Debug.LogError($"Korvayne Runtime DLL architecture mismatch. Use Windows x86_64 builds only. {ex.Message}");
                return false;
            }
            catch (Exception ex)
            {
                _status = KorvayneStatus.Failed;
                Debug.LogError($"Korvayne Runtime failed to load: {ex.Message}");
                return false;
            }
        }

        public static void RequireReady()
        {
            if (!Load())
            {
                throw new InvalidOperationException("Korvayne Runtime is not available. Block protected play until anticheat.dll is installed correctly next to the game executable.");
            }
        }

        public static void Shutdown()
        {
            if (!IsReady)
            {
                return;
            }

            try
            {
                AC_Shutdown();
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"Korvayne shutdown failed: {ex.Message}");
            }
        }

        public static void Tick()
        {
            if (!IsReady)
            {
                return;
            }

            AC_Tick();
        }

        public static void SetGameId(string value) => CallString(AC_SetGameId, value);
        public static void SetEnvironment(string value) => CallString(AC_SetEnvironment, value);
        public static void SetIdentityProvider(string value) => CallString(AC_SetIdentityProvider, value);
        public static void SetPlayerId(string value) => CallString(AC_SetPlayerId, value);
        public static void SetSessionId(string value) => CallString(AC_SetSessionId, value);
        public static void SetPlatformUserId(string value) => CallString(AC_SetPlatformUserId, value);
        public static void SetGameBuild(string value) => CallString(AC_SetGameBuild, value);
        public static void SetTelemetryToken(string value) => CallString(AC_SetTelemetryToken, value);

        public static void ReportAim(float aimSpeedPerMs, float reactionMs, bool hadLineOfSight, bool hit)
        {
            if (!IsReady)
            {
                return;
            }

            AC_ReportAim(aimSpeedPerMs, reactionMs, hadLineOfSight ? 1 : 0, hit ? 1 : 0);
        }

        public static int ProtectSaveFile(string path, byte[] serializedSave, string context)
        {
            if (!IsReady || string.IsNullOrWhiteSpace(path) || serializedSave == null)
            {
                return -1;
            }

            return AC_ProtectSaveFile(path, serializedSave, (uint)serializedSave.Length, context ?? "");
        }

        public static bool TryVerifySaveFile(string path, string context, out byte[] serializedSave, out int result)
        {
            serializedSave = Array.Empty<byte>();
            if (!IsReady || string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            {
                result = -1;
                return false;
            }

            var cap = Math.Max(1024, (int)new FileInfo(path).Length);
            var buffer = new byte[cap];
            result = AC_VerifySaveFile(path, context ?? "", buffer, (uint)buffer.Length, out var outLen);
            if (result != SaveOk)
            {
                return false;
            }

            serializedSave = new byte[outLen];
            Buffer.BlockCopy(buffer, 0, serializedSave, 0, (int)outLen);
            return true;
        }

        public static string SaveResultName(int result)
        {
            try
            {
                var p = AC_SaveResultName(result);
                return p == IntPtr.Zero ? result.ToString() : Marshal.PtrToStringAnsi(p) ?? result.ToString();
            }
            catch
            {
                return result.ToString();
            }
        }

        internal static void GuardFloat(string name, IntPtr address)
        {
            if (IsReady && address != IntPtr.Zero)
            {
                AC_GuardFloat(name ?? "", address);
            }
        }

        internal static void SetGuardedFloat(IntPtr address, float value)
        {
            if (IsReady && address != IntPtr.Zero)
            {
                AC_SetGuardedFloat(address, value);
            }
        }

        internal static void UnguardFloat(IntPtr address)
        {
            if (IsReady && address != IntPtr.Zero)
            {
                AC_UnguardFloat(address);
            }
        }

        internal static void GuardInt(string name, IntPtr address)
        {
            if (IsReady && address != IntPtr.Zero)
            {
                AC_GuardI32(name ?? "", address);
            }
        }

        internal static void SetGuardedInt(IntPtr address, int value)
        {
            if (IsReady && address != IntPtr.Zero)
            {
                AC_SetGuardedI32(address, value);
            }
        }

        internal static void UnguardInt(IntPtr address)
        {
            if (IsReady && address != IntPtr.Zero)
            {
                AC_UnguardI32(address);
            }
        }

        private delegate void StringSetter(string value);

        private static void CallString(StringSetter setter, string value)
        {
            if (!IsReady)
            {
                return;
            }

            setter(value ?? "");
        }

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        private static extern IntPtr AC_Version();

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        private static extern void AC_Tick();

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        private static extern void AC_Shutdown();

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
        private static extern void AC_SetGameId(string value);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
        private static extern void AC_SetEnvironment(string value);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
        private static extern void AC_SetIdentityProvider(string value);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
        private static extern void AC_SetPlayerId(string value);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
        private static extern void AC_SetSessionId(string value);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
        private static extern void AC_SetPlatformUserId(string value);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
        private static extern void AC_SetGameBuild(string value);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
        private static extern void AC_SetTelemetryToken(string value);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
        private static extern void AC_GuardFloat(string name, IntPtr address);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        private static extern void AC_SetGuardedFloat(IntPtr address, float value);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        private static extern void AC_UnguardFloat(IntPtr address);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
        private static extern void AC_GuardI32(string name, IntPtr address);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        private static extern void AC_SetGuardedI32(IntPtr address, int value);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        private static extern void AC_UnguardI32(IntPtr address);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        private static extern void AC_ReportAim(float aimSpeedPerMs, float reactionMs, int hadLineOfSight, int hit);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
        private static extern int AC_ProtectSaveFile(string path, byte[] plain, uint plainLen, string context);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
        private static extern int AC_VerifySaveFile(string path, string context, byte[] outPlain, uint outCap, out uint outLen);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        private static extern IntPtr AC_SaveResultName(int rc);
    }
}
