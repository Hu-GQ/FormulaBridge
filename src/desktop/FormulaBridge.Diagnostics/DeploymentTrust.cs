using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
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
                string signer = VerifyManifestSignature(deployment);
                if (!string.Equals(signer, VerifyManifestSignature(application), StringComparison.OrdinalIgnoreCase)) return "failed";
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
                Exception failure = error is TargetInvocationException && error.InnerException != null ? error.InnerException : error;
                if (failure is UnauthorizedAccessException || failure is SecurityException) return "blocked";
                if (failure is CryptographicException) return TrustFailure(failure.HResult);
                return "failed";
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

        private static string VerifyManifestSignature(XmlDocument document)
        {
            const BindingFlags all = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            Assembly deployment = Assembly.Load("System.Deployment, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a");
            Type verifierType = deployment.GetType("System.Deployment.Internal.CodeSigning.SignedCmiManifest2", true);
            ConstructorInfo constructor = verifierType.GetConstructor(all, null, new[] { typeof(XmlDocument), typeof(bool) }, null);
            MethodInfo verify = verifierType.GetMethod("Verify", all);
            if (constructor == null || verify == null || verify.GetParameters().Length != 1) throw new InvalidOperationException("ClickOnce verifier is unavailable");

            // Keep the file-backed DOM. Cloning it before SignedXml verification loses
            // context needed by the .NET Framework ClickOnce verifier and reports a false bad digest.
            object verifier = constructor.Invoke(new object[] { document, true });
            Type flagsType = verify.GetParameters()[0].ParameterType;
            const int RevocationCheckEntireChain = 4;
            const int UrlCacheOnlyRetrieval = 8;
            verify.Invoke(verifier, new[] { Enum.ToObject(flagsType, RevocationCheckEntireChain | UrlCacheOnlyRetrieval) });

            object strongName = verifierType.GetProperty("StrongNameSignerInfo", all).GetValue(verifier, null);
            object authenticode = verifierType.GetProperty("AuthenticodeSignerInfo", all).GetValue(verifier, null);
            if (strongName == null || strongName.GetType().GetProperty("PublicKey", all).GetValue(strongName, null) == null || authenticode == null)
                throw new CryptographicException("Incomplete ClickOnce signature");
            var chain = authenticode.GetType().GetProperty("SignerChain", all).GetValue(authenticode, null) as X509Chain;
            if (chain == null || chain.ChainElements.Count == 0) throw new CryptographicException("Missing ClickOnce signer chain");
            string thumbprint = chain.ChainElements[0].Certificate.Thumbprint;
            if (string.IsNullOrWhiteSpace(thumbprint)) throw new CryptographicException("Missing ClickOnce signer certificate");
            return thumbprint;
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
