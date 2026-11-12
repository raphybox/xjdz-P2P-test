' XuanJi Pinball - Local Dev Launcher (windowless)
' Double-click this file: it starts node server.js (hidden) and opens the launcher page.
' No black console window, so it will never "flash and close" like a .bat does.

Option Explicit

Dim fso, ws, scriptDir, nodeExe, i, up

Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ws.CurrentDirectory = scriptDir

Function ShellRun(cmd)
  ShellRun = ws.Run(cmd, 0, True)
End Function

Function FindNode()
  Dim prof, verDir, f, vFolder, p
  FindNode = ""
  ' 1) node in system PATH?
  If ShellRun("node --version") = 0 Then
    FindNode = "node"
    Exit Function
  End If
  ' 2) fall back to WorkBuddy private node dir
  prof = ws.ExpandEnvironmentStrings("%USERPROFILE%")
  verDir = prof & "\.workbuddy\binaries\node\versions"
  If fso.FolderExists(verDir) Then
    Set f = fso.GetFolder(verDir)
    For Each vFolder In f.SubFolders
      p = vFolder.Path & "\node.exe"
      If fso.FileExists(p) Then
        FindNode = p
        Exit Function
      End If
    Next
  End If
End Function

Function ServerUp()
  Dim http
  ServerUp = False
  On Error Resume Next
  Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
  http.Open "GET", "http://127.0.0.1:8787/api/status", False
  http.SetTimeouts 1500, 1500, 1500, 1500
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Then ServerUp = True
  End If
  On Error GoTo 0
End Function

If Not ServerUp() Then
  nodeExe = FindNode()
  If nodeExe = "" Then
    MsgBox "Cannot find node.exe. Please install Node.js, or run this inside WorkBuddy.", 48, "XuanJi Pinball"
    WScript.Quit 1
  End If
  ' start server hidden (window style 0). cwd is already scriptDir.
  ws.Run """" & nodeExe & """ server.js", 0, False
  up = False
  For i = 1 To 40
    WScript.Sleep 500
    If ServerUp() Then up = True: Exit For
  Next
  If Not up Then
    MsgBox "Local server failed to start. Please confirm node works, or check the project folder.", 48, "XuanJi Pinball"
    WScript.Quit 1
  End If
End If

' open the launcher page in the default browser
ws.Run "http://127.0.0.1:8787/launcher.html", 1, False
