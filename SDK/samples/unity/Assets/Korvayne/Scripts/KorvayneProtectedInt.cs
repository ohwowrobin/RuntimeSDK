using System;
using System.Runtime.InteropServices;

namespace Korvayne
{
    public sealed class KorvayneProtectedInt : IDisposable
    {
        private readonly IntPtr _address;
        private bool _disposed;

        public string Name { get; }

        public KorvayneProtectedInt(string name, int initialValue = 0)
        {
            Name = string.IsNullOrWhiteSpace(name) ? "protected.int" : name;
            _address = Marshal.AllocHGlobal(4);
            Marshal.WriteInt32(_address, initialValue);
            KorvayneSdk.GuardInt(Name, _address);
            Set(initialValue);
        }

        public int Get()
        {
            ThrowIfDisposed();
            return Marshal.ReadInt32(_address);
        }

        public void Set(int value)
        {
            ThrowIfDisposed();
            KorvayneSdk.SetGuardedInt(_address, value);
            if (!KorvayneSdk.IsReady)
            {
                Marshal.WriteInt32(_address, value);
            }
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            KorvayneSdk.UnguardInt(_address);
            Marshal.FreeHGlobal(_address);
            _disposed = true;
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(nameof(KorvayneProtectedInt));
            }
        }
    }
}
