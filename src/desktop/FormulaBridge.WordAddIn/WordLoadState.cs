using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;

namespace FormulaBridge.WordAddIn
{
    internal static class WordLoadState
    {
        private static readonly object SyncRoot = new object();
        private static string addInStartedAt;
        private static string ribbonLoadedAt;
        private static string wordVersion;

        internal static void RecordAddInStarted(string version)
        {
            lock (SyncRoot)
            {
                wordVersion = version;
                addInStartedAt = UtcNow();
                Write();
            }
        }

        internal static void RecordRibbonLoaded()
        {
            lock (SyncRoot)
            {
                ribbonLoadedAt = UtcNow();
                Write();
            }
        }

        private static string UtcNow()
        {
            return DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        }

        private static void Write()
        {
            string directory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "FormulaBridge",
                "Phase0");
            string destination = Path.Combine(directory, "word-load-state.json");
            string temporary = destination + "." + Guid.NewGuid().ToString("N") + ".tmp";
            string json = "{\n" +
                "  \"schemaVersion\": 1,\n" +
                "  \"addInId\": \"FormulaBridge.WordAddIn\",\n" +
                "  \"processId\": " + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture) + ",\n" +
                "  \"wordVersion\": \"" + Escape(wordVersion) + "\",\n" +
                "  \"addInStartedAt\": " + JsonString(addInStartedAt) + ",\n" +
                "  \"ribbonLoadedAt\": " + JsonString(ribbonLoadedAt) + "\n" +
                "}\n";

            Directory.CreateDirectory(directory);
            File.WriteAllText(temporary, json, new UTF8Encoding(false));

            if (File.Exists(destination))
            {
                try
                {
                    File.Replace(temporary, destination, null);
                    return;
                }
                catch (PlatformNotSupportedException)
                {
                }

                File.Delete(destination);
            }

            File.Move(temporary, destination);
        }

        private static string JsonString(string value)
        {
            return value == null ? "null" : "\"" + Escape(value) + "\"";
        }

        private static string Escape(string value)
        {
            if (value == null)
            {
                return string.Empty;
            }

            return value
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\r", "\\r")
                .Replace("\n", "\\n");
        }
    }
}
