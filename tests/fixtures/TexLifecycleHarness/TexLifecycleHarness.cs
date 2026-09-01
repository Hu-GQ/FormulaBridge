using System.Text.Json;

namespace FormulaBridge.TexSandbox;

// A test host links the exact production request validator and sandbox code.
// It is not installed with FormulaBridge and exposes no additional product API.
internal static class TexLifecycleHarness
{
    public static int Main(string[] args)
    {
        if (args.Length != 1) return 2;
        var reports = new List<object>();
        var originalOutput = Console.Out;
        string? hostFailure = null;
        try
        {
        var sequencePath = Path.GetFullPath(args[0]);
        var root = Path.GetDirectoryName(sequencePath)!;
        using var sequence = JsonDocument.Parse(File.ReadAllText(sequencePath));
        foreach (var item in sequence.RootElement.EnumerateArray())
        {
            var requestPath = Inside(root, item.GetProperty("request").GetString()!);
            using var request = JsonDocument.Parse(File.ReadAllText(requestPath));
            var jobRoot = Inside(root, request.RootElement.GetProperty("jobRoot").GetString()!);
            var outputRoot = Inside(jobRoot, request.RootElement.GetProperty("outputDirectory").GetString()!);
            var cancelWhenReady = item.TryGetProperty("cancelWhenReady", out var cancel) && cancel.GetBoolean();
            using var cancellation = new CancellationTokenSource();
            using var observerStop = new CancellationTokenSource();
            var cancelObserved = false;
            var observer = Task.Run(async () =>
            {
                if (!cancelWhenReady) return;
                try
                {
                    while (!observerStop.IsCancellationRequested)
                    {
                        if (File.Exists(Path.Combine(outputRoot, "cancel-ready.txt")))
                        { cancelObserved = true; cancellation.Cancel(); return; }
                        await Task.Delay(25, observerStop.Token);
                    }
                }
                catch (OperationCanceledException) { }
            });
            using var captured = new StringWriter();
            int exitCode;
            try
            {
                Console.SetOut(captured);
                exitCode = Program.RunRequest(requestPath, cancellation.Token);
            }
            finally
            {
                Console.SetOut(originalOutput);
                observerStop.Cancel();
                observer.GetAwaiter().GetResult();
            }
            using var result = JsonDocument.Parse(captured.ToString());
            bool producedPdf = Directory.EnumerateFiles(outputRoot, "*.pdf").Any();
            var markerPath = Path.Combine(outputRoot, "attack-result.txt");
            var marker = File.Exists(markerPath) && new FileInfo(markerPath).Length < 64 ? File.ReadAllText(markerPath).Trim() : "missing";
            if (marker != "blocked" && marker != "escaped") marker = "missing";
            var childArtifact = File.Exists(Path.Combine(outputRoot, "shell-escape.txt")) || File.Exists(Path.Combine(outputRoot, "process-escape.txt"));
            bool removed = false;
            try { Directory.Delete(Inside(root, jobRoot), true); removed = !Directory.Exists(jobRoot); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            reports.Add(new
            {
                id = item.GetProperty("id").GetString(),
                hostProcessId = Environment.ProcessId,
                exitCode, cancelObserved, producedPdf, jobDirectoryRemoved = removed,
                attackMarker = marker, childArtifact,
                result = result.RootElement.Clone()
            });
        }
        }
        catch (Exception)
        {
            // Never publish machine paths or exception text in portable evidence.
            hostFailure = "lifecycle-host-incomplete";
        }
        finally
        {
            Console.SetOut(originalOutput);
            originalOutput.WriteLine(JsonSerializer.Serialize(new { schemaVersion = 1, hostFailure, cases = reports }));
        }
        return hostFailure is null ? 0 : 1;
    }

    private static string Inside(string root, string candidate)
    {
        var prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var path = Path.GetFullPath(Path.IsPathRooted(candidate) ? candidate : Path.Combine(root, candidate));
        if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || WindowsTexSandbox.PathContainsReparsePoint(path))
            throw new InvalidOperationException("Lifecycle fixture path escaped its workspace");
        return path;
    }
}
