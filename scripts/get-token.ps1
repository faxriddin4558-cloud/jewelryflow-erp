Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public class Win32Cred {
    [DllImport("Advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public int flags;
        public int type;
        public string targetName;
        public string comment;
        public long lastWritten;
        public int credentialBlobSize;
        public IntPtr credentialBlob;
        public int persist;
        public int attributeCount;
        public IntPtr attributes;
        public string targetAlias;
        public string userName;
    }

    public static string Read(string target) {
        IntPtr ptr = IntPtr.Zero;
        if (CredRead(target, 1, 0, out ptr)) {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
            byte[] bytes = new byte[cred.credentialBlobSize];
            Marshal.Copy(cred.credentialBlob, bytes, 0, cred.credentialBlobSize);
            return Encoding.UTF8.GetString(bytes);
        }
        return null;
    }
}
'@

$targets = @(
    "Supabase CLI:access-token",
    "LegacyGeneric:target=Supabase CLI:access-token"
)

foreach ($t in $targets) {
    $res = [Win32Cred]::Read($t)
    if ($res) {
        [Console]::Out.Write($res)
        exit 0
    }
}
exit 1
