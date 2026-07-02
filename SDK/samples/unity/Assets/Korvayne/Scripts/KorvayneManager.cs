using UnityEngine;

namespace Korvayne
{
#pragma warning disable CS0649
    public sealed class KorvayneManager : MonoBehaviour
    {
        [Header("Runtime context")]
        [SerializeField] private string gameId = "";
        [SerializeField] private string environment = "production";
        [SerializeField] private string identityProvider = "steam";
        [SerializeField] private string gameBuild = "";

        [Header("Lifecycle")]
        [SerializeField] private bool tickEveryFrame;
        [SerializeField] private bool shutdownOnQuit = true;

        private bool _ownsSdk;

        public static KorvayneManager Instance { get; private set; }
        public bool IsReady => KorvayneSdk.IsReady;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;
            DontDestroyOnLoad(gameObject);
            _ownsSdk = true;

            if (!KorvayneSdk.Load())
            {
                return;
            }

            KorvayneSdk.SetGameId(gameId);
            KorvayneSdk.SetEnvironment(environment);
            KorvayneSdk.SetIdentityProvider(identityProvider);
            KorvayneSdk.SetGameBuild(gameBuild);
        }

        private void Update()
        {
            if (tickEveryFrame)
            {
                KorvayneSdk.Tick();
            }
        }

        private void OnApplicationQuit()
        {
            if (_ownsSdk && shutdownOnQuit)
            {
                KorvayneSdk.Shutdown();
            }
        }

        private void OnDestroy()
        {
            if (Instance == this)
            {
                Instance = null;
            }
        }

        public void SetPlayerContext(string playerId, string sessionId, string platformUserId, string telemetryToken = "")
        {
            KorvayneSdk.SetPlayerId(playerId);
            KorvayneSdk.SetSessionId(sessionId);
            KorvayneSdk.SetPlatformUserId(platformUserId);

            if (!string.IsNullOrWhiteSpace(telemetryToken))
            {
                KorvayneSdk.SetTelemetryToken(telemetryToken);
            }
        }

        public void SetTelemetryToken(string token)
        {
            KorvayneSdk.SetTelemetryToken(token);
        }

        public void ReportShot(float aimSpeedPerMs, float reactionMs, bool hadLineOfSight, bool hit)
        {
            KorvayneSdk.ReportAim(aimSpeedPerMs, reactionMs, hadLineOfSight, hit);
        }
    }
#pragma warning restore CS0649
}
