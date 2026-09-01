using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;

namespace FormulaBridge.Diagnostics
{
    [DataContract]
    internal sealed class DiagnosticCheck
    {
        internal DiagnosticCheck(string id, string status, string reason, string remediation)
        { Id = id; Status = status; Reason = reason; Remediation = remediation; }
        [DataMember(Name = "id", Order = 1)] internal string Id { get; private set; }
        [DataMember(Name = "status", Order = 2)] internal string Status { get; private set; }
        [DataMember(Name = "reason", Order = 3)] internal string Reason { get; private set; }
        [DataMember(Name = "remediation", Order = 4)] internal string Remediation { get; private set; }
    }

    [DataContract]
    internal sealed class VstoDiagnosticReport
    {
        [DataMember(Name = "schemaVersion", Order = 1)] internal int SchemaVersion { get; set; }
        [DataMember(Name = "addInId", Order = 2)] internal string AddInId { get; set; }
        [DataMember(Name = "status", Order = 3)] internal string Status { get; set; }
        [DataMember(Name = "capturedAt", Order = 4)] internal string CapturedAt { get; set; }
        [DataMember(Name = "checks", Order = 5)] internal List<DiagnosticCheck> Checks { get; set; }
    }

    [DataContract]
    internal sealed class WordLoadState
    {
        [DataMember(Name = "schemaVersion")] internal int SchemaVersion { get; set; }
        [DataMember(Name = "addInId")] internal string AddInId { get; set; }
        [DataMember(Name = "processId")] internal int ProcessId { get; set; }
        [DataMember(Name = "addInStartedAt")] internal string AddInStartedAt { get; set; }
        [DataMember(Name = "ribbonLoadedAt")] internal string RibbonLoadedAt { get; set; }
    }

    // Observations are separated from evaluation so fault tests never mutate Office.
    internal sealed class DiagnosticSnapshot
    {
        internal string WordVersion;
        internal string WordPlatform;
        internal string VstoVersion;
        internal string[] WebViewVersions = new string[0];
        internal bool RegistrationPresent;
        internal int? LoadBehavior;
        internal bool LocalManifestExists;
        internal string SignatureStatus = "blocked";
        internal bool PolicyDisables;
        internal bool CrashListed;
        internal bool DisabledItemMarker;
        internal int DisabledItemCount;
        internal WordLoadState LoadState;
        internal bool WordProcessRunning;
        internal DateTime WordProcessStartedAt;
        internal DateTime Now = DateTime.UtcNow;
        internal HashSet<string> Unavailable = new HashSet<string>(StringComparer.Ordinal);
    }

    internal static class VstoDiagnostics
    {
        internal const string AddInId = "FormulaBridge.WordAddIn";
        internal static VstoDiagnosticReport Capture() { return Evaluate(WindowsDiagnosticProbe.Capture()); }

        internal static VstoDiagnosticReport Evaluate(DiagnosticSnapshot snapshot)
        {
            var checks = new List<DiagnosticCheck>();
            Add(checks, snapshot, "word-x64", ValidVersion(snapshot.WordVersion) && snapshot.WordPlatform == "x64",
                "Word x64 is installed.", "A supported x64 Word installation was not detected.",
                "Install a supported x64 Word edition, then rerun diagnostics.");
            Add(checks, snapshot, "vsto-runtime", ValidVersion(snapshot.VstoVersion),
                "The VSTO Runtime is installed.", "The VSTO Runtime is missing or its version is invalid.",
                "Run the separately signed VSTO prerequisite installer, then restart Word.");
            Add(checks, snapshot, "webview2-runtime", Array.Exists(snapshot.WebViewVersions, ValidVersion),
                "The WebView2 Evergreen Runtime is installed.", "The WebView2 Runtime is missing or its version is invalid; editing is unavailable.",
                "Run the separately signed WebView2 prerequisite installer, then restart Word.");
            Add(checks, snapshot, "current-user-registration", snapshot.RegistrationPresent,
                "The current-user Word add-in registration exists.", "The current-user Word add-in registration is missing.",
                "Run Repair from the signed FormulaBridge installer for this Windows account.");
            Add(checks, snapshot, "local-signed-manifest", snapshot.LocalManifestExists,
                "The registered local deployment manifest exists.", "The local deployment manifest is missing or its registration is invalid.",
                "Close Word and repair FormulaBridge using its signed installer.");
            string signatureStatus = snapshot.Unavailable.Contains("deployment-signatures") ? "blocked" : snapshot.SignatureStatus;
            checks.Add(new DiagnosticCheck("deployment-signatures", signatureStatus,
                signatureStatus == "passed" ? "Deployment and application manifests and installed binaries passed signature verification." :
                signatureStatus == "failed" ? "A deployment signature, certificate trust check, or payload hash failed." :
                "Signature verification could not be completed with the local trust information.",
                signatureStatus == "passed" ? "" : "Repair from the signed installer. If trust information is unavailable, ask the administrator to restore it; do not disable signature verification."));
            Add(checks, snapshot, "load-behavior", snapshot.LoadBehavior == 3,
                "Word automatic loading is registered.", "LoadBehavior is missing or is not 3.",
                "Check Word Options > Add-ins. If permitted, use the signed installer Repair action.");
            string policyReason = snapshot.PolicyDisables ? "Office policy disables this add-in; diagnostics will not bypass policy." :
                snapshot.CrashListed ? "Word lists this add-in as crashing; diagnostics will not force-enable it." :
                snapshot.DisabledItemMarker ? "Word DisabledItems contains FormulaBridge; diagnostics will not force-enable it." :
                snapshot.DisabledItemCount > 0 ? "Word contains opaque DisabledItems entries; this tool cannot safely exclude FormulaBridge." :
                "No blocking policy or Word disabled-item entry was detected.";
            string policyStatus = snapshot.Unavailable.Contains("resiliency-and-policy") ? "blocked" :
                snapshot.PolicyDisables || snapshot.CrashListed || snapshot.DisabledItemMarker ? "failed" :
                snapshot.DisabledItemCount > 0 ? "blocked" : "passed";
            checks.Add(new DiagnosticCheck("resiliency-and-policy", policyStatus,
                snapshot.Unavailable.Contains("resiliency-and-policy") ? "Office policy or disabled-item information could not be read." : policyReason,
                policyStatus == "passed" ? "" : snapshot.PolicyDisables ? "Contact the Office policy administrator. This tool does not change organization policy." :
                "Inspect Word Options > Add-ins > Disabled Items and the crash report before deciding whether to enable the add-in."));

            bool current = IsCurrentState(snapshot);
            Add(checks, snapshot, "add-in-load-state", current,
                "The VSTO startup callback belongs to the running Word process.",
                "No current VSTO startup callback was found; Word may be closed or the saved state may be stale.",
                "Start Word and rerun diagnostics. If the Ribbon is absent, address the preceding failures.");
            DateTime ribbon;
            DateTime started;
            bool ribbonLoaded = current && ParseTime(snapshot.LoadState.RibbonLoadedAt, out ribbon) &&
                ParseTime(snapshot.LoadState.AddInStartedAt, out started) && ribbon >= started && ribbon <= snapshot.Now;
            Add(checks, snapshot, "ribbon-load-state", ribbonLoaded,
                "The FormulaBridge Ribbon onLoad callback belongs to the running Word process.", "No current FormulaBridge Ribbon onLoad callback was found.",
                "Restart Word and check the FormulaBridge tab, then rerun diagnostics.");
            return new VstoDiagnosticReport
            {
                SchemaVersion = 1, AddInId = AddInId,
                Status = checks.Exists(c => c.Status == "failed") ? "failed" : checks.Exists(c => c.Status == "blocked") ? "blocked" : "passed",
                CapturedAt = snapshot.Now.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"), Checks = checks
            };
        }

        internal static bool ValidVersion(string value)
        { Version version; return Version.TryParse(value, out version) && version > new Version(0, 0, 0, 0); }

        private static bool ParseTime(string value, out DateTime time)
        { return DateTime.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.RoundtripKind, out time) && time.Kind == DateTimeKind.Utc; }

        private static bool IsCurrentState(DiagnosticSnapshot snapshot)
        {
            DateTime started;
            return snapshot.LoadState != null && snapshot.LoadState.SchemaVersion == 1 && snapshot.LoadState.AddInId == AddInId &&
                snapshot.LoadState.ProcessId > 0 && snapshot.WordProcessRunning &&
                ParseTime(snapshot.LoadState.AddInStartedAt, out started) && started >= snapshot.WordProcessStartedAt && started <= snapshot.Now;
        }

        private static void Add(List<DiagnosticCheck> checks, DiagnosticSnapshot snapshot, string id, bool passed, string success, string failure, string remediation)
        {
            bool unavailable = snapshot.Unavailable.Contains(id);
            checks.Add(new DiagnosticCheck(id, unavailable ? "blocked" : passed ? "passed" : "failed",
                unavailable ? "The required local observation could not be read." : passed ? success : failure,
                passed && !unavailable ? "" : remediation));
        }

        internal static string Serialize(VstoDiagnosticReport report)
        {
            var serializer = new DataContractJsonSerializer(typeof(VstoDiagnosticReport));
            using (var stream = new MemoryStream())
            { serializer.WriteObject(stream, report); return Encoding.UTF8.GetString(stream.ToArray()) + "\n"; }
        }
    }
}
