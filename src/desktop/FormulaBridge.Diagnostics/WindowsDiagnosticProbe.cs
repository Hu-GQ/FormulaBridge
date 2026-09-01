using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security;
using System.Text;
using Microsoft.Win32;

namespace FormulaBridge.Diagnostics
{
    internal static class WindowsDiagnosticProbe
    {
        private const string AddInPath = "Software\\Microsoft\\Office\\Word\\Addins\\FormulaBridge.WordAddIn";
        private const string Resiliency = "Software\\Microsoft\\Office\\16.0\\Word\\Resiliency";
        private const string Policy = "Software\\Policies\\Microsoft\\Office\\16.0\\Word\\Resiliency";
        private const string WebView = "Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

        internal static DiagnosticSnapshot Capture()
        {
            var result = new DiagnosticSnapshot();
            Observe(result, new[] { "word-x64" }, delegate {
                result.WordVersion = Read(RegistryHive.LocalMachine, RegistryView.Registry64, "SOFTWARE\\Microsoft\\Office\\ClickToRun\\Configuration", "VersionToReport");
                result.WordPlatform = Read(RegistryHive.LocalMachine, RegistryView.Registry64, "SOFTWARE\\Microsoft\\Office\\ClickToRun\\Configuration", "Platform");
            });
            Observe(result, new[] { "vsto-runtime" }, delegate {
                const string key = "SOFTWARE\\Microsoft\\VSTO Runtime Setup\\v4R";
                result.VstoVersion = Read(RegistryHive.LocalMachine, RegistryView.Registry64, key, "Version") ??
                    Read(RegistryHive.LocalMachine, RegistryView.Registry32, key, "Version");
            });
            Observe(result, new[] { "webview2-runtime" }, delegate {
                result.WebViewVersions = new[] {
                    Read(RegistryHive.CurrentUser, RegistryView.Registry64, WebView, "pv"),
                    Read(RegistryHive.LocalMachine, RegistryView.Registry32, WebView, "pv") };
            });
            Observe(result, new[] { "current-user-registration", "load-behavior", "local-signed-manifest", "deployment-signatures" }, delegate {
                string manifest = Read(RegistryHive.CurrentUser, RegistryView.Registry64, AddInPath, "Manifest");
                result.RegistrationPresent = !string.IsNullOrWhiteSpace(manifest);
                int behavior;
                if (int.TryParse(Read(RegistryHive.CurrentUser, RegistryView.Registry64, AddInPath, "LoadBehavior"), out behavior)) result.LoadBehavior = behavior;
                string localPath = LocalManifestPath(manifest);
                result.LocalManifestExists = localPath != null && File.Exists(localPath);
                result.SignatureStatus = result.LocalManifestExists ? DeploymentTrust.Verify(localPath) : "blocked";
            });
            Observe(result, new[] { "resiliency-and-policy" }, delegate {
                foreach (RegistryHive hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
                {
                    string managed = Read(hive, RegistryView.Registry64, Policy + "\\AddinList", VstoDiagnostics.AddInId);
                    result.PolicyDisables |= managed == "0" ||
                        (Read(hive, RegistryView.Registry64, Policy, "RestrictToList") == "1" && managed != "1" && managed != "2");
                }
                result.CrashListed = Read(RegistryHive.CurrentUser, RegistryView.Registry64, Resiliency + "\\CrashingAddinList", VstoDiagnostics.AddInId) != null;
                using (RegistryKey root = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, RegistryView.Registry64))
                using (RegistryKey key = root.OpenSubKey(Resiliency + "\\DisabledItems", false))
                {
                    if (key != null) foreach (string name in key.GetValueNames())
                    {
                        result.DisabledItemCount++;
                        byte[] bytes = key.GetValue(name) as byte[];
                        if (bytes != null) result.DisabledItemMarker |=
                            Encoding.Unicode.GetString(bytes).IndexOf(VstoDiagnostics.AddInId, StringComparison.OrdinalIgnoreCase) >= 0 ||
                            Encoding.ASCII.GetString(bytes).IndexOf(VstoDiagnostics.AddInId, StringComparison.OrdinalIgnoreCase) >= 0;
                    }
                }
            });
            Observe(result, new[] { "add-in-load-state", "ribbon-load-state" }, delegate {
                string statePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FormulaBridge", "Phase0", "word-load-state.json");
                if (!File.Exists(statePath) || new FileInfo(statePath).Length > 64 * 1024) return;
                try
                {
                    using (var file = File.OpenRead(statePath))
                        result.LoadState = (WordLoadState)new DataContractJsonSerializer(typeof(WordLoadState)).ReadObject(file);
                }
                catch (SerializationException) { return; }
                if (result.LoadState == null || result.LoadState.ProcessId <= 0) return;
                try
                {
                    using (Process word = Process.GetProcessById(result.LoadState.ProcessId))
                    {
                        result.WordProcessRunning = !word.HasExited && string.Equals(word.ProcessName, "WINWORD", StringComparison.OrdinalIgnoreCase);
                        result.WordProcessStartedAt = word.StartTime.ToUniversalTime();
                    }
                }
                catch (ArgumentException) { result.WordProcessRunning = false; }
            });
            return result;
        }

        internal static string LocalManifestPath(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || !value.StartsWith("file:///", StringComparison.OrdinalIgnoreCase) ||
                !value.EndsWith("|vstolocal", StringComparison.OrdinalIgnoreCase)) return null;
            Uri uri;
            if (!Uri.TryCreate(value.Substring(0, value.Length - "|vstolocal".Length), UriKind.Absolute, out uri) || !uri.IsFile || uri.IsUnc) return null;
            try
            {
                string path = Path.GetFullPath(uri.LocalPath);
                return DeploymentTrust.IsLocalPlainPath(path) ? path : null;
            }
            catch (ArgumentException) { return null; }
            catch (NotSupportedException) { return null; }
        }

        private static string Read(RegistryHive hive, RegistryView view, string path, string name)
        {
            using (RegistryKey root = RegistryKey.OpenBaseKey(hive, view))
            using (RegistryKey key = root.OpenSubKey(path, false))
                return key == null || key.GetValue(name) == null ? null : Convert.ToString(key.GetValue(name));
        }

        private static void Observe(DiagnosticSnapshot result, string[] ids, Action action)
        {
            try { action(); }
            catch (Exception error)
            {
                if (!(error is IOException || error is UnauthorizedAccessException || error is SecurityException ||
                    error is SerializationException || error is ArgumentException || error is InvalidOperationException || error is System.ComponentModel.Win32Exception)) throw;
                foreach (string id in ids) result.Unavailable.Add(id);
            }
        }
    }
}
