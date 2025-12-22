using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace IconPositionHelper;

internal static class Win32
{
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string? lpClassName, string? lpWindowName);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string? lpszClass, string? lpszWindow);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr VirtualAllocEx(IntPtr hProcess, IntPtr lpAddress, UIntPtr dwSize, uint flAllocationType, uint flProtect);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool VirtualFreeEx(IntPtr hProcess, IntPtr lpAddress, UIntPtr dwSize, uint dwFreeType);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress, byte[] lpBuffer, UIntPtr nSize, out UIntPtr lpNumberOfBytesWritten);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress, byte[] lpBuffer, UIntPtr nSize, out UIntPtr lpNumberOfBytesRead);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    public const uint LVM_GETITEMCOUNT = 0x1004;
    public const uint LVM_GETITEMPOSITION = 0x1010;
    public const uint LVM_GETITEMTEXTW = 0x1073;
    public const uint LVIF_TEXT = 0x0001;

    public const uint PROCESS_VM_OPERATION = 0x0008;
    public const uint PROCESS_VM_READ = 0x0010;
    public const uint PROCESS_VM_WRITE = 0x0020;
    public const uint PROCESS_QUERY_INFORMATION = 0x0400;

    public const uint MEM_COMMIT = 0x1000;
    public const uint MEM_RESERVE = 0x2000;
    public const uint PAGE_READWRITE = 0x04;
    public const uint MEM_RELEASE = 0x8000;
}

[StructLayout(LayoutKind.Sequential)]
internal struct POINT
{
    public int X;
    public int Y;
}

[StructLayout(LayoutKind.Sequential)]
internal struct RECT
{
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
internal struct LVITEMW
{
    public uint mask;
    public int iItem;
    public int iSubItem;
    public uint state;
    public uint stateMask;
    public IntPtr pszText;
    public int cchTextMax;
    public int iImage;
    public IntPtr lParam;
    public int iIndent;
    public int iGroupId;
    public uint cColumns;
    public IntPtr puColumns;
}

internal class IconPosition
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("x")]
    public int X { get; set; }

    [JsonPropertyName("y")]
    public int Y { get; set; }
}

internal class DesktopOrigin
{
    [JsonPropertyName("x")]
    public int X { get; set; }

    [JsonPropertyName("y")]
    public int Y { get; set; }
}

internal class OutputData
{
    [JsonPropertyName("desktopOrigin")]
    public DesktopOrigin DesktopOrigin { get; set; } = new DesktopOrigin();

    [JsonPropertyName("icons")]
    public List<IconPosition> Icons { get; set; } = new List<IconPosition>();
}

internal class Program
{
    private static void WriteDiagnostics(string message)
    {
        Console.Error.WriteLine($"[DIAG] {message}");
    }

    private static IntPtr? FindDesktopListView()
    {
        IntPtr progman = Win32.FindWindow("Progman", null);
        if (progman == IntPtr.Zero)
        {
            WriteDiagnostics("ERROR: Could not find Progman window");
            return null;
        }

        IntPtr shell = Win32.FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (shell == IntPtr.Zero)
        {
            IntPtr workerW = IntPtr.Zero;
            do
            {
                workerW = Win32.FindWindowEx(IntPtr.Zero, workerW, "WorkerW", null);
                if (workerW != IntPtr.Zero)
                {
                    shell = Win32.FindWindowEx(workerW, IntPtr.Zero, "SHELLDLL_DefView", null);
                    if (shell != IntPtr.Zero) break;
                }
            } while (workerW != IntPtr.Zero);

            if (shell == IntPtr.Zero)
            {
                WriteDiagnostics("ERROR: Could not find SHELLDLL_DefView window");
                return null;
            }
        }

        IntPtr listView = Win32.FindWindowEx(shell, IntPtr.Zero, "SysListView32", null);
        if (listView == IntPtr.Zero)
        {
            WriteDiagnostics("ERROR: Could not find SysListView32 window");
            return null;
        }

        return listView;
    }

    private static int GetListViewItemCount(IntPtr hListView)
    {
        IntPtr count = Win32.SendMessage(hListView, Win32.LVM_GETITEMCOUNT, IntPtr.Zero, IntPtr.Zero);
        return count.ToInt32();
    }

    private static string GetListViewItemText(IntPtr hListView, IntPtr hExplorerProcess, int index)
    {
        const int bufferChars = 1024;
        const int bufferBytes = bufferChars * sizeof(char);

        IntPtr remoteTextBuf = IntPtr.Zero;
        IntPtr remoteLvitem = IntPtr.Zero;

        try
        {
            remoteTextBuf = Win32.VirtualAllocEx(hExplorerProcess, IntPtr.Zero, new UIntPtr((uint)bufferBytes),
                Win32.MEM_COMMIT | Win32.MEM_RESERVE, Win32.PAGE_READWRITE);

            if (remoteTextBuf == IntPtr.Zero)
            {
                return string.Empty;
            }

            int lvitemSize = Marshal.SizeOf<LVITEMW>();
            remoteLvitem = Win32.VirtualAllocEx(hExplorerProcess, IntPtr.Zero, new UIntPtr((uint)lvitemSize),
                Win32.MEM_COMMIT | Win32.MEM_RESERVE, Win32.PAGE_READWRITE);

            if (remoteLvitem == IntPtr.Zero)
            {
                return string.Empty;
            }

            LVITEMW lvitem = new LVITEMW
            {
                mask = Win32.LVIF_TEXT,
                iItem = index,
                iSubItem = 0,
                pszText = remoteTextBuf,
                cchTextMax = bufferChars
            };

            byte[] lvitemBytes = new byte[lvitemSize];
            IntPtr lvitemPtr = Marshal.AllocHGlobal(lvitemSize);
            try
            {
                Marshal.StructureToPtr(lvitem, lvitemPtr, false);
                Marshal.Copy(lvitemPtr, lvitemBytes, 0, lvitemSize);
            }
            finally
            {
                Marshal.FreeHGlobal(lvitemPtr);
            }

            if (!Win32.WriteProcessMemory(hExplorerProcess, remoteLvitem, lvitemBytes, new UIntPtr((uint)lvitemSize), out _))
            {
                return string.Empty;
            }

            IntPtr result = Win32.SendMessage(hListView, Win32.LVM_GETITEMTEXTW, index, remoteLvitem);

            if (result.ToInt32() > 0)
            {
                byte[] textBytes = new byte[bufferBytes];
                if (Win32.ReadProcessMemory(hExplorerProcess, remoteTextBuf, textBytes, new UIntPtr((uint)bufferBytes), out UIntPtr bytesRead))
                {
                    if (bytesRead.ToUInt32() == 0 || bytesRead.ToUInt32() > bufferBytes)
                    {
                        return string.Empty;
                    }

                    int charCount = (int)(bytesRead.ToUInt32() / sizeof(char));
                    if (charCount == 0)
                    {
                        return string.Empty;
                    }

                    string text = Encoding.Unicode.GetString(textBytes, 0, Math.Min(charCount * sizeof(char), (int)bytesRead.ToUInt32()));
                    int nullIndex = text.IndexOf('\0');
                    if (nullIndex >= 0)
                    {
                        text = text.Substring(0, nullIndex);
                    }

                    if (string.IsNullOrWhiteSpace(text))
                    {
                        return string.Empty;
                    }

                    return text.Trim();
                }
            }
        }
        finally
        {
            if (remoteTextBuf != IntPtr.Zero)
            {
                Win32.VirtualFreeEx(hExplorerProcess, remoteTextBuf, UIntPtr.Zero, Win32.MEM_RELEASE);
            }
            if (remoteLvitem != IntPtr.Zero)
            {
                Win32.VirtualFreeEx(hExplorerProcess, remoteLvitem, UIntPtr.Zero, Win32.MEM_RELEASE);
            }
        }

        return string.Empty;
    }

    private static bool GetListViewItemPosition(IntPtr hListView, IntPtr hExplorerProcess, int index, out POINT pt)
    {
        pt = new POINT { X = 0, Y = 0 };

        int pointSize = Marshal.SizeOf<POINT>();
        IntPtr remotePoint = IntPtr.Zero;

        try
        {
            remotePoint = Win32.VirtualAllocEx(hExplorerProcess, IntPtr.Zero, new UIntPtr((uint)pointSize),
                Win32.MEM_COMMIT | Win32.MEM_RESERVE, Win32.PAGE_READWRITE);

            if (remotePoint == IntPtr.Zero)
            {
                return false;
            }

            IntPtr result = Win32.SendMessage(hListView, Win32.LVM_GETITEMPOSITION, index, remotePoint);

            if (result != IntPtr.Zero)
            {
                byte[] pointBytes = new byte[pointSize];
                if (Win32.ReadProcessMemory(hExplorerProcess, remotePoint, pointBytes, new UIntPtr((uint)pointSize), out _))
                {
                    IntPtr pointPtr = Marshal.AllocHGlobal(pointSize);
                    try
                    {
                        Marshal.Copy(pointBytes, 0, pointPtr, pointSize);
                        pt = Marshal.PtrToStructure<POINT>(pointPtr);
                        return true;
                    }
                    finally
                    {
                        Marshal.FreeHGlobal(pointPtr);
                    }
                }
            }
        }
        finally
        {
            if (remotePoint != IntPtr.Zero)
            {
                Win32.VirtualFreeEx(hExplorerProcess, remotePoint, UIntPtr.Zero, Win32.MEM_RELEASE);
            }
        }

        return false;
    }

    static void Main(string[] args)
    {
        IntPtr hExplorerProcess = IntPtr.Zero;

        try
        {
            IntPtr? listViewHwnd = FindDesktopListView();
            if (listViewHwnd == null || listViewHwnd.Value == IntPtr.Zero)
            {
                WriteDiagnostics("FATAL: Could not locate desktop ListView");
                Environment.Exit(1);
                return;
            }

            IntPtr hListView = listViewHwnd.Value;

            // Get desktop ListView client area origin in screen coordinates
            POINT clientOrigin = new POINT { X = 0, Y = 0 };
            if (!Win32.ClientToScreen(hListView, ref clientOrigin))
            {
                WriteDiagnostics("FATAL: Could not get ListView client origin");
                Environment.Exit(1);
                return;
            }

            DesktopOrigin desktopOrigin = new DesktopOrigin
            {
                X = clientOrigin.X,
                Y = clientOrigin.Y
            };

            WriteDiagnostics($"Desktop ListView origin: x={desktopOrigin.X}, y={desktopOrigin.Y}");

            uint explorerPid = 0;
            Win32.GetWindowThreadProcessId(hListView, out explorerPid);
            if (explorerPid == 0)
            {
                WriteDiagnostics("FATAL: Could not get Explorer process ID");
                Environment.Exit(1);
                return;
            }

            uint accessRights = Win32.PROCESS_VM_OPERATION | Win32.PROCESS_VM_READ | Win32.PROCESS_VM_WRITE | Win32.PROCESS_QUERY_INFORMATION;
            hExplorerProcess = Win32.OpenProcess(accessRights, false, explorerPid);
            if (hExplorerProcess == IntPtr.Zero)
            {
                WriteDiagnostics("FATAL: Could not open Explorer process");
                Environment.Exit(1);
                return;
            }

            int itemCount = GetListViewItemCount(hListView);
            WriteDiagnostics($"Icon count: {itemCount}");

            List<IconPosition> icons = new List<IconPosition>();

            for (int i = 0; i < itemCount; i++)
            {
                string iconName = GetListViewItemText(hListView, hExplorerProcess, i);
                if (string.IsNullOrWhiteSpace(iconName))
                {
                    continue;
                }

                if (!GetListViewItemPosition(hListView, hExplorerProcess, i, out POINT clientPt))
                {
                    continue;
                }

                // Keep icon coordinates as ListView client coordinates (not converted to screen)
                // Desktop origin will be applied in renderer to convert to screen coordinates
                icons.Add(new IconPosition
                {
                    Name = iconName,
                    X = clientPt.X,
                    Y = clientPt.Y
                });
            }

            WriteDiagnostics($"Successfully processed {icons.Count} icons");

            var options = new JsonSerializerOptions
            {
                WriteIndented = false
            };

            OutputData output = new OutputData
            {
                DesktopOrigin = desktopOrigin,
                Icons = icons
            };

            string json = JsonSerializer.Serialize(output, options);
            Console.WriteLine(json);

            Environment.Exit(0);
        }
        catch (Exception ex)
        {
            WriteDiagnostics($"FATAL EXCEPTION: {ex.Message}");
            Environment.Exit(1);
        }
        finally
        {
            if (hExplorerProcess != IntPtr.Zero)
            {
                Win32.CloseHandle(hExplorerProcess);
            }
        }
    }
}

