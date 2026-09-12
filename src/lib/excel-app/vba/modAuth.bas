Option Explicit
' ------------------------------------------------------------------------------------------
' Sign in, roles, users and passwords
' ------------------------------------------------------------------------------------------

Private Const SALT As String = "marina-cd-2026:"

' SHA-256 through the .NET runtime on Windows; a simple hash elsewhere. Stored as "sha256:<hex>|simple:<hex>".
Public Function HashPassword(ByVal pwd As String) As String
    HashPassword = Sha256Hex(SALT & pwd) & "|" & SimpleHash(SALT & pwd)
End Function

Public Function PasswordMatches(ByVal pwd As String, ByVal stored As String) As Boolean
    Dim sha As String, simple As String
    If Len(stored) = 0 Then Exit Function
    sha = Sha256Hex(SALT & pwd)
    simple = SimpleHash(SALT & pwd)
    If Len(sha) > 0 And InStr(1, stored, sha, vbTextCompare) > 0 Then
        PasswordMatches = True
    ElseIf InStr(1, stored, simple, vbTextCompare) > 0 Then
        PasswordMatches = True
    End If
End Function

Private Function Sha256Hex(ByVal s As String) As String
    On Error GoTo nope
    Dim enc As Object, sha As Object, bytes() As Byte, hash() As Byte, i As Long, out As String
    Set enc = CreateObject("System.Text.UTF8Encoding")
    Set sha = CreateObject("System.Security.Cryptography.SHA256Managed")
    bytes = enc.GetBytes_4(s)
    hash = sha.ComputeHash_2(bytes)
    For i = LBound(hash) To UBound(hash)
        out = out & Right$("0" & Hex$(hash(i)), 2)
    Next i
    Sha256Hex = "sha256:" & LCase$(out)
    Exit Function
nope:
    Sha256Hex = ""
End Function

' FNV-1a style hash over the UTF-16 code units, folded to 8 hex digits, repeated with 4 seeds (32 hex digits).
Private Function SimpleHash(ByVal s As String) As String
    Dim seed As Long, i As Long, h As Double, out As String, code As Long
    For seed = 1 To 4
        h = 2166136261# + seed * 7919
        For i = 1 To Len(s)
            code = AscW(Mid$(s, i, 1))
            If code < 0 Then code = code + 65536
            h = (h * 16777619#) + code
            h = h - Int(h / 4294967296#) * 4294967296#
        Next i
        out = out & Right$("00000000" & Hex$(CLng(h - Int(h / 2147483648#) * 2147483648#)), 8)
    Next seed
    SimpleHash = "simple:" & LCase$(out)
End Function

' ---- sign in -----------------------------------------------------------------------------

Public Function TrySignIn(ByVal email As String, ByVal pwd As String, ByRef message As String) As Boolean
    Dim lo As ListObject, r As Long
    Set lo = TableOf("tblUsers")
    r = FindRow(lo, "Email", email)
    If r = 0 Then
        message = "No user with that email address."
        Exit Function
    End If
    If LCase$(CellText(lo, r, "Active")) <> "yes" Then
        message = "This user is inactive. Ask an administrator."
        Exit Function
    End If
    If Not PasswordMatches(pwd, CellText(lo, r, "Password hash")) Then
        message = "Wrong password."
        Exit Function
    End If
    SetNamed "SignedInUser", CellText(lo, r, "Name")
    SetNamed "SignedInEmail", CellText(lo, r, "Email")
    SetNamed "SignedInRole", LCase$(CellText(lo, r, "Role"))
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Last login")).Value = Now
    If LCase$(CellText(lo, r, "Must change")) = "yes" Then
        Dim np As String
        np = AskNewPassword()
        If Len(np) > 0 Then
            lo.DataBodyRange.Cells(r, ColIndex(lo, "Password hash")).Value = HashPassword(np)
            lo.DataBodyRange.Cells(r, ColIndex(lo, "Must change")).Value = "No"
            MsgBox "Your password has been changed.", vbInformation, APP_TITLE
        End If
    End If
    LogActivity "Sign in", CellText(lo, r, "Email")
    TrySignIn = True
End Function

Public Function AskNewPassword() As String
    Dim p1 As String, p2 As String
    p1 = InputBox("Choose a new password (at least 8 characters). It replaces your starting password.", APP_TITLE & " – new password")
    If Len(p1) < 8 Then
        If Len(p1) > 0 Then MsgBox "The password must be at least 8 characters.", vbExclamation, APP_TITLE
        Exit Function
    End If
    p2 = InputBox("Type the new password again.", APP_TITLE & " – confirm")
    If p1 <> p2 Then
        MsgBox "The two passwords differ – not changed.", vbExclamation, APP_TITLE
        Exit Function
    End If
    AskNewPassword = p1
End Function

Public Function CurrentRole() As String
    CurrentRole = LCase$(CStr(Nz(NamedValue("SignedInRole"))))
End Function

Public Function IsSignedIn() As Boolean
    IsSignedIn = Len(CurrentRole()) > 0
End Function

Public Function CanEdit() As Boolean
    Select Case CurrentRole()
        Case "admin", "editor", "contributor": CanEdit = True
        Case Else: CanEdit = False
    End Select
End Function

Public Function IsAdmin() As Boolean
    IsAdmin = (CurrentRole() = "admin")
End Function

Public Function RequireEditor() As Boolean
    If Not CanEdit() Then
        MsgBox "Your role (" & CurrentRole() & ") cannot change data. Ask an administrator for editor rights.", vbExclamation, APP_TITLE
        RequireEditor = False
    Else
        RequireEditor = True
    End If
End Function

Public Function RequireAdmin() As Boolean
    If Not IsAdmin() Then
        MsgBox "Only an administrator can do this.", vbExclamation, APP_TITLE
        RequireAdmin = False
    Else
        RequireAdmin = True
    End If
End Function

' ---- users (admin) -----------------------------------------------------------------------

Public Sub ChangeMyPassword()
    If Not IsSignedIn() Then Exit Sub
    Dim lo As ListObject, r As Long, np As String
    Set lo = TableOf("tblUsers")
    r = FindRow(lo, "Email", CStr(NamedValue("SignedInEmail")))
    If r = 0 Then Exit Sub
    np = AskNewPassword()
    If Len(np) = 0 Then Exit Sub
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Password hash")).Value = HashPassword(np)
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Must change")).Value = "No"
    LogActivity "Password changed", CStr(NamedValue("SignedInEmail"))
    MsgBox "Your password has been changed.", vbInformation, APP_TITLE
End Sub

Public Sub AdminSetPassword()
    If Not RequireAdmin() Then Exit Sub
    Dim lo As ListObject, r As Long, email As String, np As String
    Set lo = TableOf("tblUsers")
    email = InputBox("Email of the user whose password you want to set:", APP_TITLE)
    If Len(email) = 0 Then Exit Sub
    r = FindRow(lo, "Email", email)
    If r = 0 Then
        MsgBox "No user with that email. Add the user as a row of the Users table first.", vbExclamation, APP_TITLE
        Exit Sub
    End If
    np = InputBox("New password for " & email & " (at least 8 characters). The user will be asked to change it at the next sign in.", APP_TITLE)
    If Len(np) < 8 Then Exit Sub
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Password hash")).Value = HashPassword(np)
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Must change")).Value = "Yes"
    If Len(CellText(lo, r, "Active")) = 0 Then lo.DataBodyRange.Cells(r, ColIndex(lo, "Active")).Value = "Yes"
    If Len(CellText(lo, r, "Role")) = 0 Then lo.DataBodyRange.Cells(r, ColIndex(lo, "Role")).Value = "editor"
    LogActivity "Password set", email
    MsgBox "Password set for " & email & ".", vbInformation, APP_TITLE
End Sub

Public Sub AdminAddUser()
    If Not RequireAdmin() Then Exit Sub
    Dim lo As ListObject, nm As String, email As String, role As String, np As String, lr As ListRow
    Set lo = TableOf("tblUsers")
    nm = InputBox("Full name of the new user:", APP_TITLE)
    If Len(nm) = 0 Then Exit Sub
    email = InputBox("Email (used to sign in):", APP_TITLE)
    If Len(email) = 0 Then Exit Sub
    If FindRow(lo, "Email", email) > 0 Then
        MsgBox "A user with that email already exists.", vbExclamation, APP_TITLE
        Exit Sub
    End If
    role = LCase$(InputBox("Role: admin, editor, contributor, viewer or reporter", APP_TITLE, "editor"))
    If role <> "admin" And role <> "editor" And role <> "contributor" And role <> "viewer" And role <> "reporter" Then role = "viewer"
    np = InputBox("Starting password (at least 8 characters):", APP_TITLE, "Welcome@123")
    If Len(np) < 8 Then Exit Sub
    Set lr = lo.ListRows.Add
    lr.Range.Cells(1, ColIndex(lo, "Name")).Value = nm
    lr.Range.Cells(1, ColIndex(lo, "Email")).Value = email
    lr.Range.Cells(1, ColIndex(lo, "Role")).Value = role
    lr.Range.Cells(1, ColIndex(lo, "Active")).Value = "Yes"
    lr.Range.Cells(1, ColIndex(lo, "Password hash")).Value = HashPassword(np)
    lr.Range.Cells(1, ColIndex(lo, "Must change")).Value = "Yes"
    LogActivity "User added", email & " (" & role & ")"
    MsgBox "User added. They sign in with " & email & " and the starting password, then choose their own.", vbInformation, APP_TITLE
End Sub
