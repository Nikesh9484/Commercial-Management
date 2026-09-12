Option Explicit
' ------------------------------------------------------------------------------------------
' Start-up, sign in / out, navigation and the buttons
' ------------------------------------------------------------------------------------------

' Sheets that need a signed-in user (everything except Login).
Private Function AppSheets() As Variant
    AppSheets = Array("Home", "Registers", "Reports", "Level 2 (view)", "Setup", "Periods", "Level 1", "Level 2", "Movement", "Changes", "Claims", "Early Warnings", "Risks", "Provisional Sums", "Bonds", "Contracts", "IPCs", "Final Accounts", "Cash Flow", "Transfers", "Actions", "Snapshots", "Users", "Activity", "Lists")
End Function

' Sheets a reporter may open.
Private Function ReporterSheets() As Variant
    ReporterSheets = Array("Home", "Level 1", "Level 2", "Level 2 (view)", "Movement", "Periods", "Reports")
End Function

' Runs when the workbook opens: everything hidden until someone signs in.
Public Sub AppStart()
    On Error Resume Next
    Dim trace As String
    Application.EnableEvents = True
    Err.Clear
    SetNamed "SignedInUser", ""
    SetNamed "SignedInEmail", ""
    SetNamed "SignedInRole", ""
    Note trace, "reset the signed-in user"
    ShowLoginOnly
    Note trace, "show the Login sheet"
    FitLogin
    modNav.HideTabs
    Note trace, "fit the Login sheet"
    If Len(trace) > 0 Then ThisWorkbook.Worksheets("Login").Range("LoginMessage").Value = "Start-up notes: " & trace
End Sub

' Records the last error (if any) against a start-up step.
Private Sub Note(ByRef trace As String, ByVal stepName As String)
    If Err.Number <> 0 Then trace = trace & stepName & " - error " & Err.Number & " " & Err.Description & " | "
    Err.Clear
End Sub

' Tools > Macro > Macros > SelfTest: checks the workbook's parts one by one and reports.
Public Sub SelfTest()
    On Error Resume Next
    Dim r As String, lo As ListObject, d As Object, shp As Object, v As Variant
    r = "Excel " & Application.Version & " on " & Application.OperatingSystem & vbLf
    Err.Clear
    Set lo = TableOf("tblUsers")
    r = r & Check("Users table", RowCountOf(lo) & " users")
    Set d = New Dict
    d("a") = 1
    d.Add "B", "two"
    r = r & Check("Dictionary class", d.Count & " items, exists a=" & d.Exists("a"))
    v = HashPassword("test")
    r = r & Check("Password hashing", Left$(CStr(v), 12) & "...")
    v = NamedValue("ProgrammeCode")
    r = r & Check("Named cells", CStr(v))
    Set shp = ThisWorkbook.Worksheets("Login").Shapes("Sign in")
    r = r & Check("Sign in button", "macro = " & shp.OnAction)
    v = ThisWorkbook.Worksheets("Login").Range("LoginEmail").Address
    r = r & Check("Login cells", CStr(v))
    ThisWorkbook.Worksheets("Login").Unprotect SHEET_PWD
    ThisWorkbook.Worksheets("Login").Protect Password:=SHEET_PWD, UserInterfaceOnly:=True
    r = r & Check("Sheet protection", "ok")
    ThisWorkbook.Worksheets("Login").Range("LoginMessage").Value = ""
    r = r & Check("Write to Login sheet", "ok")
    ActiveWindow.Zoom = 100
    r = r & Check("Window zoom", "ok")
    Set lo = TableOf("tblActivity")
    LogActivity "Self test", "ok"
    r = r & Check("Activity log", RowCountOf(lo) & " rows")
    ThisWorkbook.Worksheets("Login").Range("LoginMessage").Value = Replace(r, vbLf, "  ")
    MsgBox r, vbInformation, "Self test"
End Sub

Private Function Check(ByVal what As String, ByVal detail As String) As String
    If Err.Number <> 0 Then
        Check = "FAIL " & what & ": error " & Err.Number & " " & Err.Description & vbLf
    Else
        Check = "ok   " & what & ": " & detail & vbLf
    End If
    Err.Clear
End Function

' Shows the sign-in page filling the window, whatever the screen size.
Private Sub FitLogin()
    On Error Resume Next
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("Login")
    ws.Activate
    ActiveWindow.DisplayHeadings = False
    ActiveWindow.DisplayGridlines = False
    ActiveWindow.ScrollRow = 1
    ActiveWindow.ScrollColumn = 1
    ws.Range("A1:O44").Select
    ActiveWindow.Zoom = True
    ActiveWindow.ScrollRow = 1
    ActiveWindow.ScrollColumn = 1
    ws.Range("LoginEmail").Select
End Sub

Private Sub ShowLoginOnly()
    Dim n As Variant, ws As Worksheet
    ThisWorkbook.Worksheets("Login").Visible = xlSheetVisible
    For Each n In AppSheets()
        Set ws = Nothing
        On Error Resume Next
        Set ws = ThisWorkbook.Worksheets(CStr(n))
        On Error GoTo 0
        If Not ws Is Nothing Then
            On Error Resume Next
            ws.Unprotect SHEET_PWD ' protection is re-applied for the role at sign in
            On Error GoTo 0
            ws.Visible = xlSheetVeryHidden
        End If
    Next n
    EnsureLoginButton
End Sub

' The Sign in button must exist before anyone has signed in.
Private Sub EnsureLoginButton()
    On Error Resume Next
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("Login")
    ws.Unprotect SHEET_PWD
    AddButton ws, "LoginButton", "Sign in", "modMain.SignIn", 120, 26
    ws.Protect Password:=SHEET_PWD, UserInterfaceOnly:=True
    ws.EnableSelection = xlNoRestrictions
End Sub

' The Sign in button on the Login sheet.
Public Sub SignIn()
    Dim wsL As Worksheet, email As String, pwd As String, msg As String
    On Error GoTo fail
    Application.EnableEvents = True
    Set wsL = ThisWorkbook.Worksheets("Login")
    On Error Resume Next
    wsL.Unprotect SHEET_PWD
    wsL.Protect Password:=SHEET_PWD, UserInterfaceOnly:=True
    On Error GoTo fail
    email = Trim$(CStr(Nz(wsL.Range("LoginEmail").Value)))
    pwd = CStr(Nz(wsL.Range("LoginPassword").Value))
    wsL.Range("LoginMessage").Value = ""
    If Len(email) = 0 Or Len(pwd) = 0 Then
        wsL.Range("LoginMessage").Value = "Type your email and password, then click Sign in."
        Exit Sub
    End If
    If Not TrySignIn(email, pwd, msg) Then
        wsL.Range("LoginMessage").Value = msg
        wsL.Range("LoginPassword").Value = ""
        Exit Sub
    End If
    wsL.Range("LoginPassword").Value = ""
    wsL.Range("LoginMessage").Value = ""
    ApplyRole
    EnsureButtons
    modNav.NavHome
    Exit Sub
fail:
    msg = "Sign in stopped with error " & Err.Number & " in " & IIf(Len(Err.Source) > 0, Err.Source, "SignIn") & ": " & Err.Description
    On Error Resume Next
    wsL.Range("LoginMessage").Value = msg
    MsgBox msg & vbCrLf & vbCrLf & "Please send this message to the administrator.", vbExclamation, APP_TITLE
End Sub

Public Sub SignOut()
    LogActivity "Sign out", ""
    AppStart
End Sub

' Shows the sheets the role may see; protects them for read-only roles.
Public Sub ApplyRole()
    Dim n As Variant, ws As Worksheet, role As String, allowed As Boolean
    role = CurrentRole()
    Application.ScreenUpdating = False
    For Each n In AppSheets()
        Set ws = Nothing
        On Error Resume Next
        Set ws = ThisWorkbook.Worksheets(CStr(n))
        On Error GoTo 0
        If ws Is Nothing Then GoTo nextSheet
        allowed = True
        If role = "reporter" Then allowed = InList(ReporterSheets(), CStr(n))
        If (CStr(n) = "Users" Or CStr(n) = "Activity") And role <> "admin" Then allowed = False
        If CStr(n) = "Snapshots" And role <> "admin" Then allowed = False
        If allowed Then
            ws.Visible = xlSheetVisible
            ws.Unprotect SHEET_PWD
            If Not CanEdit() Or CStr(n) = "Level 1" Or CStr(n) = "Home" Or CStr(n) = "Movement" Then
                ws.Protect Password:=SHEET_PWD, UserInterfaceOnly:=True, AllowFiltering:=True, AllowSorting:=True, AllowFormattingColumns:=True, AllowFormattingRows:=True
            End If
        Else
            ws.Visible = xlSheetVeryHidden
        End If
nextSheet:
    Next n
    ThisWorkbook.Worksheets("Login").Visible = xlSheetVisible
    modNav.ApplyViewVisibility
    modNav.WireNav
    modNav.HideTabs
    Application.ScreenUpdating = True
End Sub

Private Function InList(ByVal arr As Variant, ByVal v As String) As Boolean
    Dim x As Variant
    For Each x In arr
        If StrComp(CStr(x), v, vbTextCompare) = 0 Then
            InList = True
            Exit Function
        End If
    Next x
End Function

' ---- buttons: created once, on the first sign in, so the workbook needs no drawing parts ----

Private Sub AddButton(ByVal ws As Worksheet, ByVal anchor As String, ByVal caption As String, ByVal macro As String, Optional ByVal widthPt As Double = 150, Optional ByVal heightPt As Double = 22)
    Dim b As Object, rg As Range, shp As Object, sheetObj As Object
    Set sheetObj = ws ' late-bound: the legacy Buttons collection is resolved at run time on every platform
    ' the workbook ships with styled button shapes; when one exists, it only needs its macro
    On Error Resume Next
    Set shp = ws.Shapes(caption)
    On Error GoTo 0
    If Not shp Is Nothing Then
        shp.OnAction = macro
        Exit Sub
    End If
    Set rg = ws.Range(anchor)
    On Error Resume Next
    Set b = sheetObj.Buttons(caption)
    On Error GoTo 0
    If b Is Nothing Then
        Set b = sheetObj.Buttons.Add(rg.Left + 2, rg.Top + 2, widthPt, heightPt)
        b.Name = caption
    End If
    b.Caption = caption
    b.OnAction = macro
    b.Font.Bold = True
    b.Font.Size = 9
End Sub

Public Sub EnsureButtons()
    On Error Resume Next
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("Home")
    ws.Unprotect SHEET_PWD
    AddButton ws, "ButtonsRow1", "New month", "modPeriods.NewMonth", 110
    AddButton ws, "ButtonsRow1b", "Lock period", "modPeriods.LockCurrentPeriod", 110
    AddButton ws, "ButtonsRow1c", "Unlock period", "modPeriods.UnlockCurrentPeriod", 110
    AddButton ws, "ButtonsRow1d", "Recalculate", "modMain.RefreshAll", 110
    AddButton ws, "ButtonsRow1e", "Export PDF report", "modReports.ExportPdf", 130
    AddButton ws, "ButtonsRow1f", "Sign out", "modMain.SignOut", 90
    AddButton ws, "ButtonsRow2", "Import monthly report", "modImport.ImportMonthlyReport", 150
    AddButton ws, "ButtonsRow2b", "Import claims tracker", "modImport.ImportClaimsTracker", 150
    AddButton ws, "ButtonsRow2c", "Import bonds & insurance", "modImportGeneric.ImportBonds", 160
    AddButton ws, "ButtonsRow2d", "Import payment tracking", "modImportGeneric.ImportPayments", 160
    AddButton ws, "ButtonsRow2e", "Import final accounts", "modImportGeneric.ImportFinalAccounts", 150
    AddButton ws, "ButtonsRow2f", "Change my password", "modAuth.ChangeMyPassword", 140
    AddButton ws, "ButtonsRow3", "PowerPoint presentation", "modPresentation.BuildPresentation", 170
    AddButton ws, "ButtonsRow3b", "Claim EAR (Word)", "modEar.CreateClaimEar", 150
    Set ws = ThisWorkbook.Worksheets("Users")
    ws.Unprotect SHEET_PWD
    AddButton ws, "UsersButtons", "Add user", "modAuth.AdminAddUser", 100
    AddButton ws, "UsersButtons2", "Set a user's password", "modAuth.AdminSetPassword", 150
    EnsureLoginButton
    ApplyRole
End Sub

' Re-applies every calculated column and rebuilds the Movement sheet.
Public Sub RefreshAll()
    If Not IsSignedIn() Then Exit Sub
    Busy True, "Recalculating…"
    On Error GoTo done
    modPeriods.ApplyAllFormulas
    modPeriods.RebuildMovement
done:
    Busy False
    Application.Calculate
    If Err.Number <> 0 Then MsgBox "Recalculation stopped: " & Err.Description, vbExclamation, APP_TITLE
End Sub

' Navigation from the Home sheet (hyperlinks do the same; these are for buttons).
Public Sub GoHome()
    ThisWorkbook.Worksheets("Home").Activate
End Sub
