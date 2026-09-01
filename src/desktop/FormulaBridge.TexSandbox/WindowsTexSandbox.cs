using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json.Serialization;

namespace FormulaBridge.TexSandbox;

internal sealed record SandboxRunConfiguration(
    string EnginePath,
    string TexRoot,
    string EngineSha256,
    string JobRoot,
    string InputPath,
    string OutputDirectory,
    int WallClockSeconds,
    long MemoryBytes,
    int MaxOutputFiles,
    long MaxOutputBytes,
    int ActiveProcesses);

internal sealed class SandboxRunResult
{
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion => 1;

    [JsonPropertyName("status")]
    public required string Status { get; init; }

    [JsonPropertyName("code")]
    public required string Code { get; init; }

    [JsonPropertyName("exitCode")]
    public uint? ExitCode { get; init; }

    [JsonPropertyName("timedOut")]
    public bool TimedOut { get; init; }

    [JsonPropertyName("outputLimitExceeded")]
    public bool OutputLimitExceeded { get; init; }

    [JsonPropertyName("appContainerApplied")]
    public bool AppContainerApplied { get; init; }

    [JsonPropertyName("networkCapabilityCount")]
    public uint NetworkCapabilityCount { get; init; }

    [JsonPropertyName("assignedToJobBeforeResume")]
    public bool AssignedToJobBeforeResume { get; init; }

    [JsonPropertyName("engineIdentityVerified")]
    public bool EngineIdentityVerified { get; init; }

    [JsonPropertyName("engineIdentityStable")]
    public bool EngineIdentityStable { get; init; }

    [JsonPropertyName("profileDeleted")]
    public bool ProfileDeleted { get; init; }

    [JsonPropertyName("aclRestored")]
    public bool AclRestored { get; init; }

    [JsonPropertyName("texAclExplicitlyGranted")]
    public bool TexAclExplicitlyGranted { get; init; }

    [JsonPropertyName("limits")]
    public required object Limits { get; init; }
}

internal static class WindowsTexSandbox
{
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint CreateNoWindow = 0x08000000;
    private const uint StartfUseShowWindow = 0x00000001;
    private const short SwHide = 0;
    private const uint Infinite = 0xffffffff;
    private const uint WaitObject0 = 0x00000000;
    private const uint WaitTimeout = 0x00000102;
    private const uint TokenQuery = 0x0008;
    private const int TokenIsAppContainer = 29;
    private const int TokenCapabilities = 30;
    private const nuint ProcThreadAttributeSecurityCapabilities = 0x00020009;
    private const uint JobObjectLimitActiveProcess = 0x00000008;
    private const uint JobObjectLimitProcessMemory = 0x00000100;
    private const uint JobObjectLimitJobMemory = 0x00000200;
    private const uint JobObjectLimitDieOnUnhandledException = 0x00000400;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const int JobObjectBasicUiRestrictions = 4;
    private const int JobObjectExtendedLimitInformationClass = 9;
    private const uint JobObjectUiLimitAll = 0x000000ff;
    private const uint ErrorAlreadyExistsHresult = 0x800700b7;

    public static bool PathContainsReparsePoint(string candidate)
    {
        var fullPath = Path.GetFullPath(candidate);
        var root = Path.GetPathRoot(fullPath);

        if (string.IsNullOrEmpty(root))
        {
            return true;
        }

        var current = root;
        foreach (var segment in fullPath[root.Length..].Split(
            Path.DirectorySeparatorChar,
            StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            if (!File.Exists(current) && !Directory.Exists(current))
            {
                continue;
            }

            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
            {
                return true;
            }
        }

        return false;
    }

    public static SandboxRunResult Run(SandboxRunConfiguration configuration)
    {
        if (!OperatingSystem.IsWindows())
        {
            return Failed("windows-required", configuration);
        }

        var profileName = "FBTex" + Guid.NewGuid().ToString("N");
        IntPtr appContainerSidPointer = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero;
        IntPtr securityCapabilitiesPointer = IntPtr.Zero;
        IntPtr environmentPointer = IntPtr.Zero;
        IntPtr jobHandle = IntPtr.Zero;
        ProcessInformation processInformation = default;
        var profileCreated = false;
        var profileDeleted = false;
        var aclRestored = true;
        var assignedBeforeResume = false;
        var appContainerApplied = false;
        uint capabilityCount = uint.MaxValue;
        uint? exitCode = null;
        var timedOut = false;
        var outputLimitExceeded = false;
        var status = "failed";
        var code = "sandbox-internal-error";
        var stage = "sandbox-init";
        FileSystemAccessRule? texRule = null;
        FileSystemAccessRule? jobRule = null;
        FileSystemAccessRule? outputRule = null;
        SecurityIdentifier? appContainerIdentity = null;
        var engineIdentityStable = false;
        var texAclExplicitlyGranted = false;

        try
        {
            var createProfileResult = CreateAppContainerProfile(
                profileName,
                profileName,
                profileName,
                IntPtr.Zero,
                0,
                out appContainerSidPointer);
            if (createProfileResult == 0)
            {
                profileCreated = true;
            }
            else if (unchecked((uint)createProfileResult) == ErrorAlreadyExistsHresult)
            {
                var deriveSidResult = DeriveAppContainerSidFromAppContainerName(
                    profileName,
                    out appContainerSidPointer);
                if (deriveSidResult != 0 || appContainerSidPointer == IntPtr.Zero)
                {
                    throw new SandboxStageException(
                        "appcontainer-sid-derive-failed-" +
                        unchecked((uint)deriveSidResult).ToString("x8"));
                }
            }
            else
            {
                throw new SandboxStageException(
                    "appcontainer-profile-create-failed-" +
                    unchecked((uint)createProfileResult).ToString("x8"));
            }

            appContainerIdentity = new SecurityIdentifier(appContainerSidPointer);
            stage = "tex-acl-grant";
            try
            {
                texRule = GrantDirectoryAccess(
                    configuration.TexRoot,
                    appContainerIdentity,
                    FileSystemRights.ReadAndExecute | FileSystemRights.Synchronize);
                texAclExplicitlyGranted = true;
            }
            catch (UnauthorizedAccessException)
            {
                texRule = null;
            }
            stage = "job-acl-grant";
            jobRule = GrantDirectoryAccess(
                configuration.JobRoot,
                appContainerIdentity,
                FileSystemRights.ReadAndExecute | FileSystemRights.Synchronize);
            stage = "output-acl-grant";
            outputRule = GrantDirectoryAccess(
                configuration.OutputDirectory,
                appContainerIdentity,
                FileSystemRights.Modify | FileSystemRights.Synchronize);

            stage = "job-object-create";
            jobHandle = CreateJobObject(IntPtr.Zero, null);
            if (jobHandle == IntPtr.Zero)
            {
                throw new SandboxStageException(
                    "job-object-create-failed-" + Marshal.GetLastWin32Error().ToString("x8"));
            }

            stage = "job-object-configure";
            ConfigureJobObject(jobHandle, configuration);

            stage = "process-attribute-init";
            var attributeListSize = nuint.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeListSize);
            if (attributeListSize == 0)
            {
                throw new SandboxStageException(
                    "process-attribute-size-failed-" + Marshal.GetLastWin32Error().ToString("x8"));
            }

            attributeList = Marshal.AllocHGlobal(checked((int)attributeListSize));
            if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeListSize))
            {
                throw new SandboxStageException(
                    "process-attribute-init-failed-" + Marshal.GetLastWin32Error().ToString("x8"));
            }

            var securityCapabilities = new SecurityCapabilities
            {
                AppContainerSid = appContainerSidPointer,
                Capabilities = IntPtr.Zero,
                CapabilityCount = 0,
                Reserved = 0
            };
            securityCapabilitiesPointer = Marshal.AllocHGlobal(Marshal.SizeOf<SecurityCapabilities>());
            Marshal.StructureToPtr(securityCapabilities, securityCapabilitiesPointer, false);

            if (!UpdateProcThreadAttribute(
                    attributeList,
                    0,
                    ProcThreadAttributeSecurityCapabilities,
                    securityCapabilitiesPointer,
                    (nuint)Marshal.SizeOf<SecurityCapabilities>(),
                    IntPtr.Zero,
                    IntPtr.Zero))
            {
                throw new SandboxStageException(
                    "security-capabilities-attribute-failed-" + Marshal.GetLastWin32Error().ToString("x8"));
            }

            environmentPointer = Marshal.StringToHGlobalUni(BuildEnvironment(configuration));
            var startupInfo = new StartupInfoEx
            {
                StartupInfo = new StartupInfo
                {
                    Cb = Marshal.SizeOf<StartupInfoEx>(),
                    Flags = StartfUseShowWindow,
                    ShowWindow = SwHide
                },
                AttributeList = attributeList
            };
            var commandLine = new StringBuilder(BuildCommandLine(configuration));
            var creationFlags = CreateSuspended |
                CreateUnicodeEnvironment |
                ExtendedStartupInfoPresent |
                CreateNoWindow;

            stage = "process-create";
            if (!CreateProcess(
                    configuration.EnginePath,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    false,
                    creationFlags,
                    environmentPointer,
                    configuration.OutputDirectory,
                    ref startupInfo,
                    out processInformation))
            {
                throw new SandboxStageException(
                    "sandboxed-process-create-failed-" + Marshal.GetLastWin32Error().ToString("x8"));
            }

            (appContainerApplied, capabilityCount) = InspectProcessToken(processInformation.Process);
            if (!appContainerApplied || capabilityCount != 0)
            {
                TerminateProcess(processInformation.Process, 1);
                throw new SandboxStageException("sandbox-token-verification-failed");
            }

            if (!AssignProcessToJobObject(jobHandle, processInformation.Process))
            {
                TerminateProcess(processInformation.Process, 1);
                throw new SandboxStageException(
                    "job-assignment-failed-" + Marshal.GetLastWin32Error().ToString("x8"));
            }

            assignedBeforeResume = true;
            if (ResumeThread(processInformation.Thread) == uint.MaxValue)
            {
                TerminateJobObject(jobHandle, 1);
                throw new SandboxStageException(
                    "sandboxed-process-resume-failed-" + Marshal.GetLastWin32Error().ToString("x8"));
            }

            var stopwatch = Stopwatch.StartNew();
            while (true)
            {
                var waitResult = WaitForSingleObject(processInformation.Process, 50);
                if (waitResult == WaitObject0)
                {
                    var finalOutputUsage = MeasureOutput(configuration.OutputDirectory);
                    if (OutputCeilingExceeded(finalOutputUsage, configuration))
                    {
                        outputLimitExceeded = true;
                        status = "failed";
                        code = "output-ceiling-observed-after-exit";
                    }
                    else
                    {
                        status = "completed";
                        code = "process-exited";
                    }
                    break;
                }

                if (waitResult != WaitTimeout)
                {
                    TerminateJobObject(jobHandle, 1);
                    code = "process-wait-failed";
                    break;
                }

                var outputUsage = MeasureOutput(configuration.OutputDirectory);
                if (OutputCeilingExceeded(outputUsage, configuration))
                {
                    outputLimitExceeded = true;
                    status = "terminated";
                    code = "output-ceiling-exceeded";
                    TerminateJobObject(jobHandle, 1);
                    WaitForSingleObject(processInformation.Process, Infinite);
                    break;
                }

                if (stopwatch.Elapsed >= TimeSpan.FromSeconds(configuration.WallClockSeconds))
                {
                    timedOut = true;
                    status = "terminated";
                    code = "wall-clock-ceiling-exceeded";
                    TerminateJobObject(jobHandle, 1);
                    WaitForSingleObject(processInformation.Process, Infinite);
                    break;
                }
            }

            if (GetExitCodeProcess(processInformation.Process, out var nativeExitCode))
            {
                exitCode = nativeExitCode;
            }
        }
        catch (SandboxStageException error)
        {
            code = error.Code;
        }
        catch (Exception error) when (error is Win32Exception or UnauthorizedAccessException or IOException)
        {
            var nativeSuffix = error is Win32Exception nativeError
                ? "-" + nativeError.NativeErrorCode.ToString("x8")
                : string.Empty;
            code = stage + "-failed" + nativeSuffix;
        }
        finally
        {
            if (processInformation.Thread != IntPtr.Zero)
            {
                CloseHandle(processInformation.Thread);
            }
            if (processInformation.Process != IntPtr.Zero)
            {
                CloseHandle(processInformation.Process);
            }
            if (jobHandle != IntPtr.Zero)
            {
                CloseHandle(jobHandle);
            }
            if (attributeList != IntPtr.Zero)
            {
                DeleteProcThreadAttributeList(attributeList);
                Marshal.FreeHGlobal(attributeList);
            }
            if (securityCapabilitiesPointer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(securityCapabilitiesPointer);
            }
            if (environmentPointer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(environmentPointer);
            }

            aclRestored &= RemoveDirectoryAccess(configuration.OutputDirectory, outputRule);
            aclRestored &= RemoveDirectoryAccess(configuration.JobRoot, jobRule);
            aclRestored &= RemoveDirectoryAccess(configuration.TexRoot, texRule);

            if (profileCreated)
            {
                profileDeleted = DeleteAppContainerProfile(profileName) == 0;
            }
            if (appContainerSidPointer != IntPtr.Zero)
            {
                FreeSid(appContainerSidPointer);
            }

            try
            {
                var finalEngineSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(configuration.EnginePath)));
                engineIdentityStable = finalEngineSha256.Equals(
                    configuration.EngineSha256,
                    StringComparison.OrdinalIgnoreCase);
            }
            catch (IOException)
            {
                engineIdentityStable = false;
            }
        }

        return BuildResult();

        SandboxRunResult BuildResult()
        {
            return new SandboxRunResult
            {
                Status = status,
                Code = code,
                ExitCode = exitCode,
                TimedOut = timedOut,
                OutputLimitExceeded = outputLimitExceeded,
                AppContainerApplied = appContainerApplied,
                NetworkCapabilityCount = capabilityCount == uint.MaxValue ? 0 : capabilityCount,
                AssignedToJobBeforeResume = assignedBeforeResume,
                EngineIdentityVerified = true,
                EngineIdentityStable = engineIdentityStable,
                ProfileDeleted = profileDeleted,
                AclRestored = aclRestored,
                TexAclExplicitlyGranted = texAclExplicitlyGranted,
                Limits = LimitEvidence(configuration)
            };
        }
    }

    private static SandboxRunResult Failed(string code, SandboxRunConfiguration configuration)
    {
        return new SandboxRunResult
        {
            Status = "failed",
            Code = code,
            NetworkCapabilityCount = 0,
            Limits = LimitEvidence(configuration)
        };
    }

    private static object LimitEvidence(SandboxRunConfiguration configuration)
    {
        return new
        {
            wallClockSeconds = configuration.WallClockSeconds,
            memoryBytes = configuration.MemoryBytes,
            outputFiles = configuration.MaxOutputFiles,
            outputBytes = configuration.MaxOutputBytes,
            activeProcesses = configuration.ActiveProcesses
        };
    }

    private static FileSystemAccessRule GrantDirectoryAccess(
        string directoryPath,
        SecurityIdentifier identity,
        FileSystemRights rights)
    {
        var directory = new DirectoryInfo(directoryPath);
        var security = directory.GetAccessControl(AccessControlSections.Access);
        var rule = new FileSystemAccessRule(
            identity,
            rights,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
            PropagationFlags.None,
            AccessControlType.Allow);

        security.AddAccessRule(rule);
        directory.SetAccessControl(security);
        return rule;
    }

    private static bool RemoveDirectoryAccess(string directoryPath, FileSystemAccessRule? rule)
    {
        if (rule is null)
        {
            return true;
        }

        try
        {
            var directory = new DirectoryInfo(directoryPath);
            var security = directory.GetAccessControl(AccessControlSections.Access);
            security.RemoveAccessRuleSpecific(rule);
            directory.SetAccessControl(security);
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static void ConfigureJobObject(IntPtr jobHandle, SandboxRunConfiguration configuration)
    {
        var information = new JobObjectExtendedLimitInformation
        {
            BasicLimitInformation = new JobObjectBasicLimitInformation
            {
                LimitFlags = JobObjectLimitActiveProcess |
                    JobObjectLimitProcessMemory |
                    JobObjectLimitJobMemory |
                    JobObjectLimitDieOnUnhandledException |
                    JobObjectLimitKillOnJobClose,
                ActiveProcessLimit = checked((uint)configuration.ActiveProcesses)
            },
            ProcessMemoryLimit = (nuint)configuration.MemoryBytes,
            JobMemoryLimit = (nuint)configuration.MemoryBytes
        };
        var informationSize = Marshal.SizeOf<JobObjectExtendedLimitInformation>();
        var informationPointer = Marshal.AllocHGlobal(informationSize);
        var uiRestrictionsPointer = Marshal.AllocHGlobal(sizeof(uint));

        try
        {
            Marshal.StructureToPtr(information, informationPointer, false);
            if (!SetInformationJobObject(
                    jobHandle,
                    JobObjectExtendedLimitInformationClass,
                    informationPointer,
                    (uint)informationSize))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            Marshal.WriteInt32(uiRestrictionsPointer, unchecked((int)JobObjectUiLimitAll));
            if (!SetInformationJobObject(
                    jobHandle,
                    JobObjectBasicUiRestrictions,
                    uiRestrictionsPointer,
                    sizeof(uint)))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
        }
        finally
        {
            Marshal.FreeHGlobal(uiRestrictionsPointer);
            Marshal.FreeHGlobal(informationPointer);
        }
    }

    private static (bool IsAppContainer, uint CapabilityCount) InspectProcessToken(IntPtr processHandle)
    {
        if (!OpenProcessToken(processHandle, TokenQuery, out var tokenHandle))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        try
        {
            var isAppContainer = 0;
            var returnedLength = 0;
            if (!GetTokenInformation(
                    tokenHandle,
                    TokenIsAppContainer,
                    ref isAppContainer,
                    sizeof(int),
                    out returnedLength))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            GetTokenInformation(
                tokenHandle,
                TokenCapabilities,
                IntPtr.Zero,
                0,
                out var capabilitiesLength);
            if (capabilitiesLength <= 0)
            {
                return (isAppContainer != 0, 0);
            }

            var capabilitiesPointer = Marshal.AllocHGlobal(capabilitiesLength);
            try
            {
                if (!GetTokenInformation(
                        tokenHandle,
                        TokenCapabilities,
                        capabilitiesPointer,
                        capabilitiesLength,
                        out _))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                }

                return (isAppContainer != 0, unchecked((uint)Marshal.ReadInt32(capabilitiesPointer)));
            }
            finally
            {
                Marshal.FreeHGlobal(capabilitiesPointer);
            }
        }
        finally
        {
            CloseHandle(tokenHandle);
        }
    }

    private static string BuildCommandLine(SandboxRunConfiguration configuration)
    {
        return string.Join(" ", new[]
        {
            Quote(configuration.EnginePath),
            "--no-shell-escape",
            "--interaction=nonstopmode",
            "--halt-on-error",
            "--output-directory=" + Quote(configuration.OutputDirectory),
            Quote(configuration.InputPath)
        });
    }

    private static string Quote(string value)
    {
        return '"' + value + '"';
    }

    private static bool OutputCeilingExceeded(
        OutputUsage usage,
        SandboxRunConfiguration configuration)
    {
        return usage.Files > configuration.MaxOutputFiles ||
            usage.Bytes > configuration.MaxOutputBytes ||
            usage.ContainsReparsePoint;
    }

    private static string BuildEnvironment(SandboxRunConfiguration configuration)
    {
        var systemRoot = Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows";
        var variables = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["APPDATA"] = configuration.OutputDirectory,
            ["HOME"] = configuration.OutputDirectory,
            ["LOCALAPPDATA"] = configuration.OutputDirectory,
            ["openin_any"] = "p",
            ["openout_any"] = "p",
            ["PATH"] = Path.GetDirectoryName(configuration.EnginePath) + ";" + Path.Combine(systemRoot, "System32"),
            ["shell_escape"] = "0",
            ["SystemDrive"] = Path.GetPathRoot(systemRoot) ?? @"C:\",
            ["SystemRoot"] = systemRoot,
            ["TEMP"] = configuration.OutputDirectory,
            ["TEXINPUTS"] = configuration.JobRoot + ";",
            ["TEXMFOUTPUT"] = configuration.OutputDirectory,
            ["TMP"] = configuration.OutputDirectory,
            ["USERPROFILE"] = configuration.OutputDirectory
        };

        return string.Join('\0', variables.Select(pair => pair.Key + "=" + pair.Value)) + "\0\0";
    }

    private static OutputUsage MeasureOutput(string outputDirectory)
    {
        var pending = new Stack<string>();
        pending.Push(outputDirectory);
        var files = 0;
        long bytes = 0;
        var containsReparsePoint = false;

        while (pending.Count > 0)
        {
            var directory = pending.Pop();
            foreach (var entry in Directory.EnumerateFileSystemEntries(directory))
            {
                var attributes = File.GetAttributes(entry);
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                {
                    containsReparsePoint = true;
                    continue;
                }

                if ((attributes & FileAttributes.Directory) != 0)
                {
                    pending.Push(entry);
                }
                else
                {
                    files++;
                    bytes += new FileInfo(entry).Length;
                }
            }
        }

        return new OutputUsage(files, bytes, containsReparsePoint);
    }

    private sealed record OutputUsage(int Files, long Bytes, bool ContainsReparsePoint);

    private sealed class SandboxStageException(string code) : Exception
    {
        public string Code { get; } = code;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityCapabilities
    {
        public IntPtr AppContainerSid;
        public IntPtr Capabilities;
        public uint CapabilityCount;
        public uint Reserved;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Cb;
        public string? Reserved;
        public string? Desktop;
        public string? Title;
        public uint X;
        public uint Y;
        public uint XSize;
        public uint YSize;
        public uint XCountChars;
        public uint YCountChars;
        public uint FillAttribute;
        public uint Flags;
        public short ShowWindow;
        public short Reserved2;
        public IntPtr ReservedPointer;
        public IntPtr StandardInput;
        public IntPtr StandardOutput;
        public IntPtr StandardError;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfoEx
    {
        public StartupInfo StartupInfo;
        public IntPtr AttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Process;
        public IntPtr Thread;
        public uint ProcessId;
        public uint ThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public nuint MinimumWorkingSetSize;
        public nuint MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public nuint Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public nuint ProcessMemoryLimit;
        public nuint JobMemoryLimit;
        public nuint PeakProcessMemoryUsed;
        public nuint PeakJobMemoryUsed;
    }

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int CreateAppContainerProfile(
        string appContainerName,
        string displayName,
        string description,
        IntPtr capabilities,
        uint capabilityCount,
        out IntPtr appContainerSid);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int DeriveAppContainerSidFromAppContainerName(
        string appContainerName,
        out IntPtr appContainerSid);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int DeleteAppContainerProfile(string appContainerName);

    [DllImport("advapi32.dll")]
    private static extern IntPtr FreeSid(IntPtr sid);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(
        IntPtr attributeList,
        int attributeCount,
        int flags,
        ref nuint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(
        IntPtr attributeList,
        uint flags,
        nuint attribute,
        IntPtr value,
        nuint size,
        IntPtr previousValue,
        IntPtr returnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfoEx startupInfo,
        out ProcessInformation processInformation);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        IntPtr information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(
        IntPtr tokenHandle,
        int tokenInformationClass,
        ref int tokenInformation,
        int tokenInformationLength,
        out int returnLength);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(
        IntPtr tokenHandle,
        int tokenInformationClass,
        IntPtr tokenInformation,
        int tokenInformationLength,
        out int returnLength);
}
