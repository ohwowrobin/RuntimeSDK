using System;
using System.Runtime.InteropServices;

namespace Korvayne
{
    public sealed class KorvayneProtectedFloat : IDisposable
    {
        private readonly IntPtr _address;
        private bool _disposed;

        public string Name { get; }

        public KorvayneProtectedFloat(string name, float initialValue = 0f)
        {
            Name = string.IsNullOrWhiteSpace(name) ? "protected.float" : name;
            _address = Marshal.AllocHGlobal(4);
            WriteRaw(initialValue);
            KorvayneSdk.GuardFloat(Name, _address);
            Set(initialValue);
        }

        public float Get()
        {
            ThrowIfDisposed();
            int bits = Marshal.ReadInt32(_address);
            return BitConverter.ToSingle(BitConverter.GetBytes(bits), 0);
        }

        public void Set(float value)
        {
            ThrowIfDisposed();
            KorvayneSdk.SetGuardedFloat(_address, value);
            if (!KorvayneSdk.IsReady)
            {
                WriteRaw(value);
            }
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            KorvayneSdk.UnguardFloat(_address);
            Marshal.FreeHGlobal(_address);
            _disposed = true;
        }

        private void WriteRaw(float value)
        {
            byte[] bytes = BitConverter.GetBytes(value);
            int bits = BitConverter.ToInt32(bytes, 0);
            Marshal.WriteInt32(_address, bits);
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(nameof(KorvayneProtectedFloat));
            }
        }
    }
}
