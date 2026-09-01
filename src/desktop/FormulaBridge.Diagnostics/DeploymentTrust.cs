using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.RegularExpressions;
using System.Xml;

namespace FormulaBridge.Diagnostics
{
    internal static class DeploymentTrust
    {
        // Verification is offline and read-only. Unknown revocation information
        // is blocked, never converted into a successful trust decision.
        internal static string Verify(string deploymentPath)
        {
            try
            {
                string root = Path.GetDirectoryName(Path.GetFullPath(deploymentPath));
                XmlDocument deployment = ReadManifest(deploymentPath);
                XmlElement dependency = deployment.SelectSingleNode("/*[local-name()='assembly']/*[local-name()='dependency']/*[local-name()='dependentAssembly' and @codebase]") as XmlElement;
                if (dependency == null) return "failed";
                string applicationPath = ResolvePayload(root, dependency.GetAttribute("codebase"));
                XmlDocument application = ReadManifest(applicationPath);
                string identity = new Uri(deploymentPath).AbsoluteUri + "#" + Identity(deployment) + "\\" + Identity(application);
                string signer = null;
                using (ActivationContext context = ActivationContext.CreatePartialActivationContext(
                    new ApplicationIdentity(identity), new[] { deploymentPath, applicationPath }))
                {
                    ManifestSignatureInformationCollection signatures = ManifestSignatureInformation.VerifySignature(
                        context, ManifestKinds.ApplicationAndDeployment, X509RevocationFlag.ExcludeRoot, X509RevocationMode.Offline);
                    if (signatures.Count != 2) return "failed";
                    foreach (ManifestSignatureInformation info in signatures)
                    {
                        if (info.StrongNameSignature == null || !info.StrongNameSignature.IsValid || info.AuthenticodeSignature == null) return "failed";
                        if (info.AuthenticodeSignature.VerificationResult != SignatureVerificationResult.Valid)
                            return TrustFailure(info.AuthenticodeSignature.HResult);
                        string current = info.AuthenticodeSignature.SigningCertificate.Thumbprint;
                        if (signer != null && !string.Equals(signer, current, StringComparison.OrdinalIgnoreCase)) return "failed";
                        signer = current;
                    }
                }
                VerifyPayloadHashes(deployment, root);
                VerifyPayloadHashes(application, Path.GetDirectoryName(applicationPath));
                foreach (string name in new[] { "FormulaBridge.WordAddIn.dll", "FormulaBridge.Diagnostics.exe" })
                {
                    string path = ResolvePayload(root, name);
                    string status = VerifyBinary(path);
                    if (status != "passed") return status;
                    using (var certificate = new X509Certificate2(X509Certificate.CreateFromSignedFile(path)))
                        if (!string.Equals(certificate.Thumbprint, signer, StringComparison.OrdinalIgnoreCase)) return "failed";
                }
                return "passed";
            }
            catch (Exception error)
            {
                if (error is UnauthorizedAccessException || error is SecurityException) return "blocked";
                if (error is IOException || error is XmlException || error is CryptographicException || error is ArgumentException || error is InvalidOperationException || error is NotSupportedException || error is COMException) return "failed";
                throw;
            }
        }

        internal static bool IsLocalPlainPath(string path)
        {
            string full = Path.GetFullPath(path);
            if (full.StartsWith("\\\\", StringComparison.Ordinal) || full.IndexOf(':', 2) >= 0) return false;
            string current = Path.GetPathRoot(full);
            foreach (string segment in full.Substring(current.Length).Split(Path.DirectorySeparatorChar))
            {
                current = Path.Combine(current, segment);
                if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return false;
            }
            return true;
        }

        internal static string ResolvePayload(string root, string relative)
        {
            if (string.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative) || relative.Contains(":") || relative.Contains("%")) throw new InvalidOperationException("Invalid payload reference");
            string prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string path = Path.GetFullPath(Path.Combine(prefix, relative.Replace('/', Path.DirectorySeparatorChar)));
            if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || !IsLocalPlainPath(path)) throw new InvalidOperationException("Payload reference escaped installation");
            return path;
        }

        private static XmlDocument ReadManifest(string path)
        {
            if (!IsLocalPlainPath(path) || new FileInfo(path).Length > 4 * 1024 * 1024) throw new InvalidOperationException("Invalid local manifest");
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 4 * 1024 * 1024 };
            var document = new XmlDocument { PreserveWhitespace = true, XmlResolver = null };
            using (XmlReader reader = XmlReader.Create(path, settings)) document.Load(reader);
            return document;
        }

        private static string Identity(XmlDocument document)
        {
            XmlElement identity = document.SelectSingleNode("/*[local-name()='assembly']/*[local-name()='assemblyIdentity']") as XmlElement;
            if (identity == null) throw new InvalidOperationException("Missing manifest identity");
            var parts = new List<string>();
            foreach (string name in new[] { "name", "version", "publicKeyToken", "processorArchitecture", "language", "type" })
            {
                string value = identity.GetAttribute(name);
                if (value.Length == 0 && (name == "language" || name == "type")) continue;
                if (!Regex.IsMatch(value, "^[A-Za-z0-9_.-]+$")) throw new InvalidOperationException("Invalid manifest identity");
                parts.Add(name == "name" ? value : (name == "language" ? "culture" : name) + "=" + value);
            }
            return string.Join(", ", parts);
        }

        internal static void VerifyPayloadHashes(XmlDocument document, string root)
        {
            foreach (XmlElement item in document.SelectNodes("/*[local-name()='assembly']/*[local-name()='file'] | /*[local-name()='assembly']/*[local-name()='dependency']/*[local-name()='dependentAssembly' and @codebase]"))
            {
                string relative = item.HasAttribute("codebase") ? item.GetAttribute("codebase") : item.GetAttribute("name");
                string path = ResolvePayload(root, relative);
                XmlElement hash = item.SelectSingleNode("*[local-name()='hash']") as XmlElement;
                if (hash == null) throw new InvalidOperationException("Missing payload hash");
                foreach (XmlElement transform in hash.SelectNodes("*[local-name()='Transforms']/*[local-name()='Transform']"))
                    if (transform.GetAttribute("Algorithm") != "urn:schemas-microsoft-com:HashTransforms.Identity") throw new InvalidOperationException("Unsupported payload transform");
                XmlElement method = hash.SelectSingleNode("*[local-name()='DigestMethod']") as XmlElement;
                XmlElement value = hash.SelectSingleNode("*[local-name()='DigestValue']") as XmlElement;
                if (method == null || value == null) throw new InvalidOperationException("Missing payload digest");
                string algorithm = method.GetAttribute("Algorithm");
                using (HashAlgorithm digest = algorithm == "http://www.w3.org/2001/04/xmlenc#sha256" ? (HashAlgorithm)SHA256.Create() :
                    algorithm == "http://www.w3.org/2000/09/xmldsig#sha1" ? SHA1.Create() : null)
                {
                    if (digest == null) throw new InvalidOperationException("Unsupported payload digest");
                    using (FileStream stream = File.OpenRead(path))
                        if (Convert.ToBase64String(digest.ComputeHash(stream)) != value.InnerText.Trim()) throw new InvalidOperationException("Payload hash mismatch");
                }
            }
        }

        internal static string VerifyBinary(string path)
        {
            if (!IsLocalPlainPath(path) || !File.Exists(path)) return "failed";
            var file = new WinTrustFile { Size = (uint)Marshal.SizeOf(typeof(WinTrustFile)), Path = path };
            IntPtr pointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WinTrustFile)));
            var data = new WinTrustData { Size = (uint)Marshal.SizeOf(typeof(WinTrustData)), UIChoice = 2, UnionChoice = 1,
                File = pointer, StateAction = 1, ProviderFlags = 0x1000 | 0x80 | 0x2000 };
            var action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
            try
            {
                Marshal.StructureToPtr(file, pointer, false);
                int result = WinVerifyTrust(new IntPtr(-1), ref action, ref data);
                return result == 0 ? "passed" : TrustFailure(result);
            }
            finally
            {
                data.StateAction = 2;
                WinVerifyTrust(new IntPtr(-1), ref action, ref data);
                Marshal.DestroyStructure(pointer, typeof(WinTrustFile));
                Marshal.FreeHGlobal(pointer);
            }
        }

        private static string TrustFailure(int code)
        { return unchecked((uint)code) == 0x80092013 || unchecked((uint)code) == 0x800b010e ? "blocked" : "failed"; }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WinTrustFile { internal uint Size; [MarshalAs(UnmanagedType.LPWStr)] internal string Path; internal IntPtr Handle; internal IntPtr KnownSubject; }
        [StructLayout(LayoutKind.Sequential)]
        private struct WinTrustData
        {
            internal uint Size; internal IntPtr PolicyCallback; internal IntPtr SipClient; internal uint UIChoice;
            internal uint RevocationChecks; internal uint UnionChoice; internal IntPtr File; internal uint StateAction;
            internal IntPtr StateData; internal IntPtr URL; internal uint ProviderFlags; internal uint UIContext; internal IntPtr SignatureSettings;
        }
        [DllImport("wintrust.dll", ExactSpelling = true, CharSet = CharSet.Unicode)]
        private static extern int WinVerifyTrust(IntPtr window, ref Guid action, ref WinTrustData data);
    }
}
