using System.Text.Json;
using System.Text.Json.Serialization;
using System.Security.Cryptography;

namespace FormulaBridge.TexSandbox;

internal static class Program
{
    private const int InputBytes = 256 * 1024;
    private const int InteractiveSeconds = 30;
    private const int BatchItemSeconds = 120;
    private const long MemoryBytes = 1024L * 1024 * 1024;
    private const int OutputFiles = 64;
    private const long OutputBytes = 64L * 1024 * 1024;
    private const int ActiveProcesses = 1;

    public static int Main(string[] args)
    {
        if (args is ["describe-policy"])
        {
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                schemaVersion = 1,
                supportedPlatform = "Windows 11 x64",
                isolationIdentity = "AppContainer",
                networkCapabilities = Array.Empty<string>(),
                executableSource = "approved-local-profile",
                useShellExecute = false,
                shellEscape = false,
                readRoots = new[] { "approved-tex-installation", "random-job" },
                writeRoots = new[] { "controlled-output" },
                rejectReparseRoots = true,
                jobLimits = new[]
                {
                    "active-process",
                    "job-memory",
                    "process-memory",
                    "kill-on-close",
                    "wall-clock"
                },
                ceilings = new
                {
                    inputBytes = InputBytes,
                    interactiveSeconds = InteractiveSeconds,
                    batchItemSeconds = BatchItemSeconds,
                    memoryBytes = MemoryBytes,
                    outputFiles = OutputFiles,
                    outputBytes = OutputBytes,
                    activeProcesses = ActiveProcesses
                }
            }));
            return 0;
        }

        if (args is ["run", "--request", _] or ["run", "--request", _, "--cancel-on-stdin"])
        {
            if (args.Length == 4 && !Console.IsInputRedirected) return Reject("cancellation-input-must-be-redirected");
            using var cancellation = new CancellationTokenSource();
            ConsoleCancelEventHandler handler = (_, eventArgs) => { eventArgs.Cancel = true; cancellation.Cancel(); };
            Console.CancelKeyPress += handler;
            if (args.Length == 4)
            {
                // This is a host control channel, never a field supplied by TeX.
                _ = Task.Run(() =>
                {
                    var command = new char[7];
                    var count = Console.In.ReadBlock(command, 0, command.Length);
                    if (new string(command, 0, count).TrimEnd('\r', '\n') == "cancel")
                    {
                        try { cancellation.Cancel(); }
                        catch (ObjectDisposedException) { }
                    }
                });
            }
            try { return RunRequest(args[2], cancellation.Token); }
            finally { Console.CancelKeyPress -= handler; }
        }

        Console.Error.WriteLine("Usage: FormulaBridge.TexSandbox describe-policy | run --request <request.json> [--cancel-on-stdin]");
        return 2;
    }

    internal static int RunRequest(string requestPath, CancellationToken cancellationToken = default)
    {
        SandboxRequest? request;

        try
        {
            if (new FileInfo(requestPath).Length > 64 * 1024) return Reject("request-ceiling-exceeded");
            request = JsonSerializer.Deserialize<SandboxRequest>(File.ReadAllText(requestPath));
        }
        catch (JsonException)
        {
            return Reject("invalid-request-json");
        }
        catch (IOException)
        {
            return Reject("request-unavailable");
        }
        catch (UnauthorizedAccessException) { return Reject("request-unavailable"); }

        if (request is null || request.SchemaVersion != 1)
        {
            return Reject("unsupported-request-schema");
        }

        var modeCeiling = request.Mode switch
        {
            "interactive" => InteractiveSeconds,
            "batch-item" => BatchItemSeconds,
            _ => 0
        };

        if (modeCeiling == 0)
        {
            return Reject("unsupported-render-mode");
        }

        if (request.TestWallClockSeconds is <= 0 || request.TestWallClockSeconds > modeCeiling)
        {
            return Reject("wall-clock-ceiling-exceeded");
        }

        if (!TryResolveInside(request.TexRoot, request.EnginePath, out _))
        {
            return Reject("engine-outside-approved-root");
        }

        if (!TryResolveInside(request.JobRoot, request.InputPath, out _) ||
            !TryResolveInside(request.JobRoot, request.OutputDirectory, out _))
        {
            return Reject("job-path-outside-random-root");
        }

        if (!Directory.Exists(request.TexRoot) ||
            !Directory.Exists(request.JobRoot) ||
            !Directory.Exists(request.OutputDirectory) ||
            !File.Exists(request.EnginePath) ||
            !File.Exists(request.InputPath))
        {
            return Reject("required-path-unavailable");
        }

        if (new FileInfo(request.InputPath).Length > InputBytes)
        {
            return Reject("input-ceiling-exceeded");
        }

        if (string.IsNullOrEmpty(request.EngineSha256) || request.EngineSha256.Length != 64 ||
            request.EngineSha256.Any(character => !Uri.IsHexDigit(character)))
        {
            return Reject("invalid-engine-identity");
        }

        var actualEngineSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(request.EnginePath)));
        if (!actualEngineSha256.Equals(request.EngineSha256, StringComparison.OrdinalIgnoreCase))
        {
            return Reject("engine-identity-mismatch");
        }

        if (WindowsTexSandbox.PathContainsReparsePoint(request.TexRoot) ||
            WindowsTexSandbox.PathContainsReparsePoint(request.EnginePath) ||
            WindowsTexSandbox.PathContainsReparsePoint(request.JobRoot) ||
            WindowsTexSandbox.PathContainsReparsePoint(request.InputPath) ||
            WindowsTexSandbox.PathContainsReparsePoint(request.OutputDirectory))
        {
            return Reject("trusted-root-contains-reparse-point");
        }

        SandboxRunResult result;

        try
        {
            result = WindowsTexSandbox.Run(new SandboxRunConfiguration(
                request.EnginePath,
                request.TexRoot,
                request.EngineSha256,
                request.JobRoot,
                request.InputPath,
                request.OutputDirectory,
                request.TestWallClockSeconds,
                MemoryBytes,
                OutputFiles,
                OutputBytes,
                ActiveProcesses), cancellationToken);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return Reject("sandbox-io-failure", "failed", 1);
        }

        Console.WriteLine(JsonSerializer.Serialize(result));
        return result.Status == "completed" ? 0 : 1;
    }

    private static bool TryResolveInside(string root, string candidate, out string resolvedCandidate)
    {
        resolvedCandidate = string.Empty;

        try
        {
            var resolvedRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
            resolvedCandidate = Path.GetFullPath(candidate);
            var relativePath = Path.GetRelativePath(resolvedRoot, resolvedCandidate);

            return relativePath != ".." &&
                !relativePath.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal) &&
                !Path.IsPathRooted(relativePath);
        }
        catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return false;
        }
    }

    private static int Reject(string code, string status = "rejected", int exitCode = 2)
    {
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            status,
            code
        }));
        return exitCode;
    }

    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
    private sealed class SandboxRequest
    {
        [JsonPropertyName("schemaVersion")]
        public int SchemaVersion { get; init; }

        [JsonPropertyName("enginePath")]
        public string EnginePath { get; init; } = string.Empty;

        [JsonPropertyName("texRoot")]
        public string TexRoot { get; init; } = string.Empty;

        [JsonPropertyName("engineSha256")]
        public string EngineSha256 { get; init; } = string.Empty;

        [JsonPropertyName("jobRoot")]
        public string JobRoot { get; init; } = string.Empty;

        [JsonPropertyName("inputPath")]
        public string InputPath { get; init; } = string.Empty;

        [JsonPropertyName("outputDirectory")]
        public string OutputDirectory { get; init; } = string.Empty;

        [JsonPropertyName("mode")]
        public string Mode { get; init; } = string.Empty;

        [JsonPropertyName("testWallClockSeconds")]
        public int TestWallClockSeconds { get; init; }
    }
}
