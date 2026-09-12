Option Explicit
' ------------------------------------------------------------------------------------------
' Navigation between the pages (the sheet tabs stay hidden, as on the website) and the
' report shown in view mode: Home, Level 1 and Level 2 follow the report chosen on Periods.
' ------------------------------------------------------------------------------------------

Private Const VIEW_SHEET As String = "Level 2 (view)"

Public Sub HideTabs()
    On Error Resume Next
    ActiveWindow.DisplayWorkbookTabs = False
End Sub

' Wires every shape named "nav:Macro", "act:Macro" or "open:Sheet" to its macro.
Public Sub WireNav()
    Dim ws As Worksheet, shp As Shape, nm As String, p As Long
    On Error Resume Next
    For Each ws In ThisWorkbook.Worksheets
        For Each shp In ws.Shapes
            nm = shp.Name
            p = InStr(nm, ":")
            If p > 0 Then
                Select Case Left$(nm, p - 1)
                    Case "nav", "act"
                        shp.OnAction = Mid$(nm, p + 1)
                    Case "open"
                        shp.OnAction = "Open" & LettersOnly(Mid$(nm, p + 1))
                End Select
            End If
        Next shp
    Next ws
End Sub

Private Function LettersOnly(ByVal s As String) As String
    Dim i As Long, ch As String
    For i = 1 To Len(s)
        ch = Mid$(s, i, 1)
        If (ch >= "A" And ch <= "Z") Or (ch >= "a" And ch <= "z") Or (ch >= "0" And ch <= "9") Then LettersOnly = LettersOnly & ch
    Next i
End Function

Private Sub GoSheet(ByVal sheetName As String)
    Dim ws As Worksheet
    If Not IsSignedIn() Then
        MsgBox "Please sign in first.", vbInformation, APP_TITLE
        Exit Sub
    End If
    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets(sheetName)
    On Error GoTo 0
    If ws Is Nothing Then Exit Sub
    If ws.Visible <> xlSheetVisible Then
        MsgBox "The " & sheetName & " page is not available for your role.", vbInformation, APP_TITLE
        Exit Sub
    End If
    ws.Activate
    HideTabs
    On Error Resume Next
    ActiveWindow.ScrollRow = 1
    ActiveWindow.ScrollColumn = 1
    ActiveWindow.Zoom = 100
End Sub

Public Sub NavHome()
    GoSheet "Home"
End Sub

Public Sub NavLevel1()
    GoSheet "Level 1"
End Sub

Public Sub NavLevel2()
    If IsViewingPast() Then GoSheet VIEW_SHEET Else GoSheet "Level 2"
End Sub

Public Sub NavMovement()
    GoSheet "Movement"
End Sub

Public Sub NavRegisters()
    GoSheet "Registers"
End Sub

Public Sub NavImports()
    GoSheet "Imports"
End Sub

Public Sub NavPeriods()
    GoSheet "Periods"
End Sub

Public Sub NavReports()
    GoSheet "Reports"
End Sub

Public Sub NavSetup()
    GoSheet "Setup"
End Sub

Public Sub NavUsers()
    GoSheet "Users"
End Sub

Public Sub OpenChanges()
    GoSheet "Changes"
End Sub

Public Sub OpenClaims()
    GoSheet "Claims"
End Sub

Public Sub OpenEarlyWarnings()
    GoSheet "Early Warnings"
End Sub

Public Sub OpenRisks()
    GoSheet "Risks"
End Sub

Public Sub OpenProvisionalSums()
    GoSheet "Provisional Sums"
End Sub

Public Sub OpenBonds()
    GoSheet "Bonds"
End Sub

Public Sub OpenContracts()
    GoSheet "Contracts"
End Sub

Public Sub OpenIPCs()
    GoSheet "IPCs"
End Sub

Public Sub OpenFinalAccounts()
    GoSheet "Final Accounts"
End Sub

Public Sub OpenCashFlow()
    GoSheet "Cash Flow"
End Sub

Public Sub OpenTransfers()
    GoSheet "Transfers"
End Sub

Public Sub OpenActions()
    GoSheet "Actions"
End Sub

' ---- the report shown (view mode) ---------------------------------------------------------

Public Function IsViewingPast() As Boolean
    IsViewingPast = CLng(Nz(NamedValue("ViewReportNo"), 0)) <> CLng(Nz(NamedValue("CurrentReportNo"), 0))
End Function

' Periods page: the report of the selected row (or asked for) becomes the report shown.
Public Sub ShowSelectedPeriod()
    If Not IsSignedIn() Then Exit Sub
    Dim lo As ListObject, r As Long, rn As Long, picked As Boolean
    Set lo = TableOf("tblPeriods")
    If ActiveSheet.Name = "Periods" And Not lo.DataBodyRange Is Nothing Then
        If Not Intersect(ActiveCell, lo.DataBodyRange) Is Nothing Then
            r = ActiveCell.Row - lo.DataBodyRange.Row + 1
            rn = CLng(Nz(lo.DataBodyRange.Cells(r, ColIndex(lo, "Report No")).Value, 0))
            picked = True
        End If
    End If
    If Not picked Then rn = CLng(Val(InputBox("Which report number do you want to see?", APP_TITLE, CStr(NamedValue("CurrentReportNo")))))
    If rn <= 0 Then Exit Sub
    ShowPeriod rn
End Sub

' The gold box on Home changed: show that report without any message.
Public Sub PickerChanged()
    Dim lbl As String, lo As ListObject, r As Long, rn As Long
    If Not IsSignedIn() Then Exit Sub
    lbl = Trim$(CStr(Nz(ThisWorkbook.Worksheets("Home").Range("ViewPicker").Value)))
    If Len(lbl) = 0 Then Exit Sub
    Set lo = TableOf("tblPeriods")
    r = FindRow(lo, "Label", lbl)
    If r = 0 Then Exit Sub
    rn = CLng(Val(CellText(lo, r, "Report No")))
    If rn <= 0 Then Exit Sub
    ShowPeriod rn, True
End Sub

' Writes the label of the report shown into the gold box on Home (without firing its change event).
Public Sub SyncPicker()
    On Error Resume Next
    Application.EnableEvents = False
    ThisWorkbook.Worksheets("Home").Range("ViewPicker").Value = CStr(NamedValue("ViewPeriodLabel"))
    Application.EnableEvents = True
End Sub

Public Sub ShowPeriod(ByVal rn As Long, Optional ByVal quiet As Boolean = False)
    Dim cur As Long
    cur = CLng(Nz(NamedValue("CurrentReportNo"), 0))
    If rn <> cur Then
        If CountOfReport(rn) = 0 Then
            MsgBox "There is no stored copy of Report No " & rn & ". Only issued (locked) reports can be shown; the current report is live.", vbInformation, APP_TITLE
            Exit Sub
        End If
        FillView rn
    End If
    SetNamed "ViewReportNo", rn
    ApplyViewVisibility
    Application.Calculate
    SyncPicker
    If quiet Then Exit Sub
    If rn = cur Then
        MsgBox "Showing the current report (live data).", vbInformation, APP_TITLE
    Else
        MsgBox "Home, Level 1 and Level 2 now show the issued copy of Report No " & rn & " (read only). The registers keep showing the current data.", vbInformation, APP_TITLE
    End If
    NavHome
End Sub

Public Sub BackToCurrent()
    If Not IsSignedIn() Then Exit Sub
    SetNamed "ViewReportNo", CLng(Nz(NamedValue("CurrentReportNo"), 0))
    ApplyViewVisibility
    Application.Calculate
    SyncPicker
    NavHome
End Sub

' Shows Level 2 or Level 2 (view) according to the report shown (for roles that may see Level 2).
Public Sub ApplyViewVisibility()
    On Error Resume Next
    Dim live As Worksheet, viewWs As Worksheet
    Set live = ThisWorkbook.Worksheets("Level 2")
    Set viewWs = ThisWorkbook.Worksheets(VIEW_SHEET)
    If live.Visible <> xlSheetVisible And viewWs.Visible <> xlSheetVisible Then Exit Sub
    If IsViewingPast() Then
        viewWs.Visible = xlSheetVisible
        live.Visible = xlSheetVeryHidden
    Else
        live.Visible = xlSheetVisible
        viewWs.Visible = xlSheetVeryHidden
    End If
End Sub

Private Function CountOfReport(ByVal rn As Long) As Long
    Dim snap As ListObject
    Set snap = TableOf("tblSnapshots")
    If snap.DataBodyRange Is Nothing Then Exit Function
    CountOfReport = Application.WorksheetFunction.CountIf(snap.ListColumns("Report No").DataBodyRange, rn)
End Function

' Copies the stored rows of a report into the Level 2 (view) table.
Private Sub FillView(ByVal rn As Long)
    Dim snap As ListObject, dst As ListObject, src As Variant, out() As Variant, i As Long, c As Long, k As Long, total As Long
    Set snap = TableOf("tblSnapshots")
    Set dst = TableOf("tblLevel2View")
    total = RowCountOf(snap)
    If total = 0 Then
        ClearTable dst
        Exit Sub
    End If
    src = snap.DataBodyRange.Value
    ReDim out(1 To total + 1, 1 To dst.ListColumns.Count)
    For i = 1 To total
        If CLng(Nz(src(i, 1), 0)) = rn Then
            k = k + 1
            For c = 1 To dst.ListColumns.Count
                out(k, c) = src(i, c + 1)
            Next c
        End If
    Next i
    FillTable dst, out, k
End Sub
