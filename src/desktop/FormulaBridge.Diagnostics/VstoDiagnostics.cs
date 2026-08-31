using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using Microsoft.Win32;

namespace FormulaBridge.Diagnostics
{
    [DataContract]
    internal sealed class DiagnosticCheck
    {
        internal DiagnosticCheck(string id, bool passed, string reason)
        {
            Id = id;
            Status = passed ? "passed" : "failed";
            Reason = reason;
        }

        [DataMember(Name = "id", Order = 1)]
        internal string Id { get; private set; }

        [DataMember(Name = "status", Order = 2)]
        internal string Status { get; private set; }

        [DataMember(Name = "reason", Order = 3)]
        internal string Reason { get; private set; }
    }

    [DataContract]
    internal sealed class VstoDiagnosticReport
    {
        [DataMember(Name = "schemaVersion", Order = 1)]
        internal int SchemaVersion { get; set; }

        [DataMember(Name = "addInId", Order = 2)]
        internal string AddInId { get; set; }

        [DataMember(Name = "status", Order = 3)]
        internal string Status { get; set; }

        [DataMember(Name = "capturedAt", Order = 4)]
        internal string CapturedAt { get; set; }

        [DataMember(Name = "checks", Order = 5)]
        internal List<DiagnosticCheck> Checks { get; set; }
    }

    [DataContract]
    internal sealed class WordLoadState
    {
        [DataMember(Name = "addInId")]
        internal string AddInId { get; set; }

        [DataMember(Name = "addInStartedAt")]
        internal string AddInStartedAt { get; set; }

        [DataMember(Name = "ribbonLoadedAt")]
        internal string RibbonLoadedAt { get; set; }
    }

    internal static class VstoDiagnostics
    {
        private const string AddInId = "FormulaBridge.WordAddIn";
        private const string AddInRegistryPath = "Software\\Microsoft\\Office\\Word\\Addins\\FormulaBridge.WordAddIn";
        private const string ClickToRunPath = "SOFTWARE\\Microsoft\\Office\\ClickToRun\\Configuration";
        private const string VstoRuntimePath = "SOFTWARE\\Microsoft\\VSTO Runtime Setup\\v4R";
        private const string VstoRuntimeWowPath = "SOFTWARE\\WOW6432Node\\Microsoft\\VSTO Runtime Setup\\v4R";
        private const string UserResiliencyPath = "Software\\Microsoft\\Office\\16.0\\Word\\Resiliency";
        private const string UserPolicyPath = "Software\\Policies\\Microsoft\\Office\\16.0\\Word\\Resiliency\\AddinList";
        private const string MachinePolicyPath = "SOFTWARE\\Policies\\Microsoft\\Office\\16.0\\Word\\Resiliency\\AddinList";

        internal static VstoDiagnosticReport Capture()
        {
            var checks = new List<DiagnosticCheck>();
            string manifestValue;
            int? loadBehavior;

            CheckWord(checks);
            CheckVstoRuntime(checks);
            ReadRegistration(checks, out manifestValue, out loadBehavior);
            CheckManifest(checks, manifestValue);
            checks.Add(new DiagnosticCheck(
                "load-behavior",
                loadBehavior == 3,
                loadBehavior == 3 ? "Word automatic loading is registered." : "LoadBehavior is missing or is not 3."));
            CheckResiliencyAndPolicy(checks);
            CheckLoadState(checks);

            return new VstoDiagnosticReport
            {
                SchemaVersion = 1,
                AddInId = AddInId,
                Status = checks.TrueForAll(delegate(DiagnosticCheck check) { return check.Status == "passed"; })
                    ? "passed"
                    : "failed",
                CapturedAt = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"),
                Checks = checks
            };
        }

        internal static string Serialize(VstoDiagnosticReport report)
        {
            var serializer = new DataContractJsonSerializer(typeof(VstoDiagnosticReport));

            using (var stream = new MemoryStream())
            {
                serializer.WriteObject(stream, report);
                return Encoding.UTF8.GetString(stream.ToArray()) + Environment.NewLine;
            }
        }

        private static void CheckWord(List<DiagnosticCheck> checks)
        {
            string version = null;
            string platform = null;

            using (RegistryKey key = OpenLocalMachine(ClickToRunPath, RegistryView.Registry64))
            {
                if (key != null)
                {
                    version = Convert.ToString(key.GetValue("VersionToReport"));
                    platform = Convert.ToString(key.GetValue("Platform"));
                }
            }

            bool passed = !string.IsNullOrWhiteSpace(version) && string.Equals(platform, "x64", StringComparison.OrdinalIgnoreCase);
            checks.Add(new DiagnosticCheck(
                "word-x64",
                passed,
                passed ? "Word x64 is installed." : "A supported x64 Word installation was not detected."));
        }

        private static void CheckVstoRuntime(List<DiagnosticCheck> checks)
        {
            string version = ReadRegistryString(RegistryHive.LocalMachine, RegistryView.Registry64, VstoRuntimePath, "Version")
                ?? ReadRegistryString(RegistryHive.LocalMachine, RegistryView.Registry64, VstoRuntimeWowPath, "Version")
                ?? ReadRegistryString(RegistryHive.LocalMachine, RegistryView.Registry32, VstoRuntimePath, "Version");

            checks.Add(new DiagnosticCheck(
                "vsto-runtime",
                !string.IsNullOrWhiteSpace(version),
                string.IsNullOrWhiteSpace(version) ? "The VSTO Runtime was not detected." : "The VSTO Runtime is installed."));
        }

        private static void ReadRegistration(
            List<DiagnosticCheck> checks,
            out string manifestValue,
            out int? loadBehavior)
        {
            manifestValue = null;
            loadBehavior = null;

            using (RegistryKey key = OpenCurrentUser(AddInRegistryPath))
            {
                if (key != null)
                {
                    manifestValue = Convert.ToString(key.GetValue("Manifest"));
                    object loadBehaviorValue = key.GetValue("LoadBehavior");

                    if (loadBehaviorValue != null)
                    {
                        loadBehavior = Convert.ToInt32(loadBehaviorValue);
                    }
                }
            }

            checks.Add(new DiagnosticCheck(
                "current-user-registration",
                !string.IsNullOrWhiteSpace(manifestValue),
                string.IsNullOrWhiteSpace(manifestValue)
                    ? "The current-user Word add-in registration is missing."
                    : "The current-user Word add-in registration exists."));
        }

        private static void CheckManifest(List<DiagnosticCheck> checks, string manifestValue)
        {
            string localPath = null;
            bool localDeployment = !string.IsNullOrWhiteSpace(manifestValue) &&
                manifestValue.StartsWith("file:///", StringComparison.OrdinalIgnoreCase) &&
                manifestValue.EndsWith("|vstolocal", StringComparison.OrdinalIgnoreCase);

            if (localDeployment)
            {
                string uriValue = manifestValue.Substring(0, manifestValue.Length - "|vstolocal".Length);
                Uri uri;

                if (Uri.TryCreate(uriValue, UriKind.Absolute, out uri) && uri.IsFile)
                {
                    localPath = uri.LocalPath;
                }
            }

            bool passed = localDeployment && localPath != null && File.Exists(localPath);
            checks.Add(new DiagnosticCheck(
                "local-signed-manifest",
                passed,
                passed
                    ? "The local VSTO deployment manifest exists. Signature verification is performed by the smoke runner."
                    : "The registered local VSTO deployment manifest is missing or invalid."));
        }

        private static void CheckResiliencyAndPolicy(List<DiagnosticCheck> checks)
        {
            string userPolicy = ReadRegistryString(RegistryHive.CurrentUser, RegistryView.Registry64, UserPolicyPath, AddInId);
            string machinePolicy = ReadRegistryString(RegistryHive.LocalMachine, RegistryView.Registry64, MachinePolicyPath, AddInId);
            bool disabledByPolicy = string.Equals(userPolicy, "0", StringComparison.Ordinal) ||
                string.Equals(machinePolicy, "0", StringComparison.Ordinal);
            bool crashListed = RegistryValueExists(RegistryHive.CurrentUser, RegistryView.Registry64, UserResiliencyPath + "\\CrashingAddinList", AddInId);

            checks.Add(new DiagnosticCheck(
                "resiliency-and-policy",
                !disabledByPolicy && !crashListed,
                disabledByPolicy
                    ? "Office policy disables the add-in; diagnostics will not bypass policy."
                    : crashListed
                        ? "Word lists the add-in as crashing; diagnostics will not force-enable it."
                        : "No explicit blocking policy or crashing-add-in entry was detected."));
        }

        private static void CheckLoadState(List<DiagnosticCheck> checks)
        {
            string statePath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "FormulaBridge",
                "Phase0",
                "word-load-state.json");
            WordLoadState state = null;

            if (File.Exists(statePath))
            {
                try
                {
                    var serializer = new DataContractJsonSerializer(typeof(WordLoadState));
                    using (FileStream stream = File.OpenRead(statePath))
                    {
                        state = (WordLoadState)serializer.ReadObject(stream);
                    }
                }
                catch (SerializationException)
                {
                }
            }

            bool addInLoaded = state != null &&
                string.Equals(state.AddInId, AddInId, StringComparison.Ordinal) &&
                !string.IsNullOrWhiteSpace(state.AddInStartedAt);
            bool ribbonLoaded = addInLoaded && !string.IsNullOrWhiteSpace(state.RibbonLoadedAt);

            checks.Add(new DiagnosticCheck(
                "add-in-load-state",
                addInLoaded,
                addInLoaded ? "The VSTO startup callback was observed." : "No valid VSTO startup callback state was found."));
            checks.Add(new DiagnosticCheck(
                "ribbon-load-state",
                ribbonLoaded,
                ribbonLoaded ? "The FormulaBridge Ribbon onLoad callback was observed." : "No valid FormulaBridge Ribbon onLoad state was found."));
        }

        private static string ReadRegistryString(
            RegistryHive hive,
            RegistryView view,
            string path,
            string name)
        {
            using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, view))
            using (RegistryKey key = baseKey.OpenSubKey(path, false))
            {
                return key == null ? null : Convert.ToString(key.GetValue(name));
            }
        }

        private static bool RegistryValueExists(
            RegistryHive hive,
            RegistryView view,
            string path,
            string name)
        {
            using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, view))
            using (RegistryKey key = baseKey.OpenSubKey(path, false))
            {
                return key != null && key.GetValue(name) != null;
            }
        }

        private static RegistryKey OpenLocalMachine(string path, RegistryView view)
        {
            return RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view).OpenSubKey(path, false);
        }

        private static RegistryKey OpenCurrentUser(string path)
        {
            return RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, RegistryView.Registry64).OpenSubKey(path, false);
        }
    }
}
