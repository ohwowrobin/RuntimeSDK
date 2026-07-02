using UnityEngine;

namespace Korvayne.Examples
{
    public sealed class KorvayneExamplePlayer : MonoBehaviour
    {
        private KorvayneProtectedFloat _health;
        private KorvayneProtectedInt _ammo;

        private void Start()
        {
            _health = new KorvayneProtectedFloat("player.health", 100f);
            _ammo = new KorvayneProtectedInt("weapon.ammo", 30);
        }

        private void Update()
        {
            if (Input.GetKeyDown(KeyCode.H))
            {
                _health.Set(Mathf.Max(0f, _health.Get() - 10f));
                Debug.Log($"Korvayne example health: {_health.Get()}");
            }

            if (Input.GetKeyDown(KeyCode.Space) && _ammo.Get() > 0)
            {
                _ammo.Set(_ammo.Get() - 1);
                KorvayneSdk.ReportAim(0.25f, 180f, hadLineOfSight: true, hit: true);
                Debug.Log($"Korvayne example ammo: {_ammo.Get()}");
            }
        }

        private void OnDestroy()
        {
            _health?.Dispose();
            _ammo?.Dispose();
        }
    }
}
