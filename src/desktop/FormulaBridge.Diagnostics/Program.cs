using System;
using System.IO;
using System.Text;

namespace FormulaBridge.Diagnostics
{
    internal static class Program
    {
        private static int Main(string[] args)
        {
            string outputPath;

            try
            {
                outputPath = ParseOutputPath(args);
                VstoDiagnosticReport report = VstoDiagnostics.Capture();
                string json = VstoDiagnostics.Serialize(report);

                if (outputPath != null)
                {
                    string outputDirectory = Path.GetDirectoryName(Path.GetFullPath(outputPath));
                    Directory.CreateDirectory(outputDirectory);
                    File.WriteAllText(outputPath, json, new UTF8Encoding(false));
                }

                Console.Out.Write(json);
                return report.Status == "passed" ? 0 : 1;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("FormulaBridge diagnostics: " + error.Message);
                return 2;
            }
        }

        private static string ParseOutputPath(string[] args)
        {
            if (args.Length == 0)
            {
                return null;
            }

            if (args.Length == 2 && string.Equals(args[0], "--output", StringComparison.Ordinal))
            {
                return args[1];
            }

            throw new ArgumentException("Usage: FormulaBridge.Diagnostics.exe [--output <report.json>]");
        }
    }
}
