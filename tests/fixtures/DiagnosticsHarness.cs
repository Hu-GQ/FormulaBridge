using System;
using System.IO;
using System.Xml;

namespace FormulaBridge.Diagnostics
{
    internal static class DiagnosticsHarness
    {
        private static int Main(string[] args)
        {
            if (args[0] == "binary") { Console.WriteLine(DeploymentTrust.VerifyBinary(args[1])); return 0; }
            if (args[0] == "manifest") { Console.WriteLine(DeploymentTrust.Verify(args[1])); return 0; }
            if (args[0] == "local-path") { Console.WriteLine(WindowsDiagnosticProbe.LocalManifestPath(args[1]) == null ? "rejected" : "accepted"); return 0; }
            if (args[0] == "payload")
            {
                try
                {
                    var document = new XmlDocument { XmlResolver = null };
                    document.Load(args[1]);
                    DeploymentTrust.VerifyPayloadHashes(document, args[2]);
                    Console.WriteLine("passed");
                }
                catch (Exception) { Console.WriteLine("failed"); }
                return 0;
            }
            var snapshot = Healthy();
            switch (args[0])
            {
                case "healthy": break;
                case "missing-registration": snapshot.RegistrationPresent = false; break;
                case "wrong-bitness": snapshot.WordPlatform = "x86"; break;
                case "missing-word": snapshot.WordVersion = null; break;
                case "missing-vsto": snapshot.VstoVersion = null; break;
                case "missing-webview": snapshot.WebViewVersions = new string[0]; break;
                case "zero-webview": snapshot.WebViewVersions = new[] { "0.0.0.0", "" }; break;
                case "invalid-webview": snapshot.WebViewVersions = new[] { "C:\\Users\\private\\bad" }; break;
                case "user-webview": snapshot.WebViewVersions = new[] { "130.0.1.0", null }; break;
                case "machine-webview": snapshot.WebViewVersions = new[] { null, "130.0.1.0" }; break;
                case "missing-manifest": snapshot.LocalManifestExists = false; break;
                case "invalid-signature": snapshot.SignatureStatus = "failed"; break;
                case "unknown-trust": snapshot.SignatureStatus = "blocked"; break;
                case "manual-disabled": snapshot.LoadBehavior = 2; break;
                case "word-disabled": snapshot.DisabledItemMarker = true; snapshot.DisabledItemCount = 1; break;
                case "word-crash": snapshot.CrashListed = true; break;
                case "opaque-disabled": snapshot.DisabledItemCount = 1; break;
                case "policy-disabled": snapshot.PolicyDisables = true; break;
                case "missing-state": snapshot.LoadState = null; break;
                case "closed-word": snapshot.WordProcessRunning = false; break;
                case "reused-pid": snapshot.WordProcessStartedAt = snapshot.Now; break;
                case "future-state": snapshot.LoadState.AddInStartedAt = snapshot.Now.AddDays(1).ToString("o"); break;
                case "future-ribbon": snapshot.LoadState.RibbonLoadedAt = snapshot.Now.AddDays(1).ToString("o"); break;
                case "ribbon-before-startup": snapshot.LoadState.RibbonLoadedAt = snapshot.Now.AddHours(-1).ToString("o"); break;
                case "malformed-time": snapshot.LoadState.AddInStartedAt = "private invalid text"; break;
                case "unsupported-state": snapshot.LoadState.SchemaVersion = 2; break;
                case "wrong-addin": snapshot.LoadState.AddInId = "Another.AddIn"; break;
                case "access-denied": snapshot.Unavailable.Add("resiliency-and-policy"); break;
                default: return 2;
            }
            Console.Write(VstoDiagnostics.Serialize(VstoDiagnostics.Evaluate(snapshot)));
            return 0;
        }

        private static DiagnosticSnapshot Healthy()
        {
            DateTime now = new DateTime(2026, 9, 1, 0, 2, 0, DateTimeKind.Utc);
            return new DiagnosticSnapshot
            {
                WordVersion = "16.0.1.0", WordPlatform = "x64", VstoVersion = "10.0.1.0",
                WebViewVersions = new[] { "130.0.1.0" }, RegistrationPresent = true, LoadBehavior = 3,
                LocalManifestExists = true, SignatureStatus = "passed", WordProcessRunning = true,
                WordProcessStartedAt = now.AddMinutes(-2), Now = now,
                LoadState = new WordLoadState { SchemaVersion = 1, AddInId = VstoDiagnostics.AddInId, ProcessId = 42,
                    AddInStartedAt = now.AddMinutes(-1).ToString("o"), RibbonLoadedAt = now.AddSeconds(-30).ToString("o") }
            };
        }
    }
}
