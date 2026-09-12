Option Explicit
' ------------------------------------------------------------------------------------------
' Start-up, sign in / out, navigation and the buttons
' ------------------------------------------------------------------------------------------

' Sheets that need a signed-in user (everything except Login).
Private Function AppSheets() As Variant
    AppSheets = Array("Home", "Setup", "Periods", "Level 1", "Level 2", "Movement", "Changes", "Claims", "Early Warnings", "Risks", "Provisional Sums", "Bonds", "Contracts", "IPCs", "Final Accounts", "Cash Flow", "Transfers", "Actions", "Snapshots", "Users", "Activity", "Lists")
End Function

' Sheets a reporter may open.
Private Function ReporterSheets() As Variant
    ReporterSheets = Array("Home", "Level 1", "Level 2", "Movement")
End Function

' Runs when the workbook opens: everything hidden until someone signs in.
Public Sub AppStart()
    On Error Resume Next
    Application.EnableEvents = False
    SetNamed "SignedInUser", ""
    SetNamed "SignedInEmail", ""
    SetNamed "SignedInRole", ""
    ShowLoginOnly
    Application.EnableEvents = True
    ThisWorkbook.Worksheets("Login").Activate
    ThisWorkbook.Worksheets("Login").Range("LoginEmail").Select
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
    Set wsL = ThisWorkbook.Worksheets("Login")
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
    ThisWorkbook.Worksheets("Home").Activate
    ThisWorkbook.Worksheets("Home").Range("A1").Select
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
    Dim b As Object, rg As Range
    Set rg = ws.Range(anchor)
    On Error Resume Next
    Set b = ws.Buttons(caption)
    On Error GoTo 0
    If b Is Nothing Then
        Set b = ws.Buttons.Add(rg.Left + 2, rg.Top + 2, widthPt, heightPt)
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
