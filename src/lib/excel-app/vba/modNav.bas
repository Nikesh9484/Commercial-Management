Option Explicit
' ------------------------------------------------------------------------------------------
' Navigation between the pages (the sheet tabs stay hidden, as on the website) and the
' report shown in view mode: Home, Level 1 and Level 2 follow the report chosen on Periods.
' ------------------------------------------------------------------------------------------

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
    GoSheet "Level 2"
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

Public Sub UndoStep()
    modUndo.UndoStep
End Sub

Public Sub UndoEntry()
    modUndo.UndoEntry
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
    Dim cur As Long, v As Long
    cur = CurrentReportNo()
    v = CLng(Nz(NamedValue("ViewReportNo"), cur))
    If rn = v Then
        SyncPicker
        Exit Sub
    End If
    If rn <> cur Then
        If Not modStore.HasStored(rn) Then
            MsgBox "There is nothing stored for Report No " & rn & " yet. Import it on the Imports page, or lock it first.", vbInformation, APP_TITLE
            SyncPicker
            Exit Sub
        End If
    End If
    Busy True, "Loading Report No " & rn & "..."
    On Error GoTo fail
    If v = cur Then modStore.SaveLive cur
    modStore.LoadLive rn
    SetNamed "ViewReportNo", rn
    Busy False
    modMain.ApplyRole
    Application.Calculate
    SyncPicker
    modUndo.AutoSave
    If quiet Then Exit Sub
    If rn = cur Then
        MsgBox "Showing the current report (live data).", vbInformation, APP_TITLE
    Else
        MsgBox "Every page now shows the issued copy of Report No " & rn & " (read only). Choose the current report to edit again.", vbInformation, APP_TITLE
    End If
    NavHome
    Exit Sub
fail:
    Busy False
    MsgBox "Could not switch report: " & Err.Description, vbExclamation, APP_TITLE
End Sub

Public Sub BackToCurrent()
    If Not IsSignedIn() Then Exit Sub
    ShowPeriod CurrentReportNo(), True
    NavHome
End Sub

' Puts the current report back into the live tables (before closing, signing out, importing, locking).
Public Sub LeaveViewMode()
    If IsViewingPast() Then ShowPeriod CurrentReportNo(), True
End Sub

Public Sub EnsureCurrentView()
    LeaveViewMode
End Sub

' Periods page: removes a report and everything stored for it.
Public Sub DeleteReport()
    If Not RequireEditor() Then Exit Sub
    Dim lo As ListObject, r As Long, rn As Long, cur As Long, newCur As Long, i As Long, n As Long, v As Long
    Set lo = TableOf("tblPeriods")
    If ActiveSheet.Name = "Periods" And Not lo.DataBodyRange Is Nothing Then
        If Not Intersect(ActiveCell, lo.DataBodyRange) Is Nothing Then
            r = ActiveCell.Row - lo.DataBodyRange.Row + 1
            rn = CLng(Val(CellText(lo, r, "Report No")))
        End If
    End If
    If rn = 0 Then rn = CLng(Val(InputBox("Which report number do you want to delete?", APP_TITLE)))
    DeleteReportNo rn
End Sub

Public Sub DeleteReportNo(ByVal rn As Long)
    If Not RequireEditor() Then Exit Sub
    Dim lo As ListObject, cur As Long, newCur As Long, i As Long, n As Long, v As Long
    Set lo = TableOf("tblPeriods")
    If rn <= 0 Then Exit Sub
    If PeriodRow(rn) = 0 Then
        MsgBox "There is no Report No " & rn & ".", vbExclamation, APP_TITLE
        Exit Sub
    End If
    cur = CurrentReportNo()
    n = RowCountOf(lo)
    For i = 1 To n
        v = CLng(Val(CellText(lo, i, "Report No")))
        If v <> rn And v > newCur Then newCur = v
    Next i
    If rn = cur And newCur = 0 Then
        MsgBox "The only report cannot be deleted.", vbExclamation, APP_TITLE
        Exit Sub
    End If
    If MsgBox("Delete Report No " & rn & " and everything stored for it (cost report, registers, library entries)? This cannot be undone." & IIf(rn = cur, vbLf & vbLf & "It is the current report: Report No " & newCur & " becomes current.", ""), vbYesNo + vbExclamation, APP_TITLE) <> vbYes Then Exit Sub
    LeaveViewMode
    modUndo.Checkpoint "Delete Report No " & rn
    Busy True, "Deleting Report No " & rn & "..."
    On Error GoTo fail
    modStore.DeleteStored rn
    lo.ListRows(PeriodRow(rn)).Delete
    If rn = cur Then
        modStore.LoadLive newCur
        SetNamed "CurrentReportNo", newCur
        SetNamed "ViewReportNo", newCur
    End If
    Busy False
    modMain.ApplyRole
    Application.Calculate
    SyncPicker
    LogActivity "Report deleted", "Report No " & rn
    modUndo.AutoSave
    MsgBox "Report No " & rn & " deleted.", vbInformation, APP_TITLE
    Exit Sub
fail:
    Busy False
    MsgBox "Could not delete the report: " & Err.Description, vbExclamation, APP_TITLE
End Sub

' Library: change the number and/or cut-off date of a report; everything stored follows the new number.
Public Sub EditReport(ByVal rn As Long)
    If Not RequireEditor() Then Exit Sub
    Dim lo As ListObject, r As Long, s As String, newNo As Long, newEnd As Date, oldEnd As Variant
    Set lo = TableOf("tblPeriods")
    r = PeriodRow(rn)
    If r = 0 Then
        MsgBox "There is no Report No " & rn & ".", vbExclamation, APP_TITLE
        Exit Sub
    End If
    s = InputBox("Report number (currently " & rn & "):", APP_TITLE, CStr(rn))
    If Len(s) = 0 Then Exit Sub
    newNo = CLng(Val(s))
    If newNo <= 0 Then Exit Sub
    If newNo <> rn And PeriodRow(newNo) > 0 Then
        MsgBox "Report No " & newNo & " already exists.", vbExclamation, APP_TITLE
        Exit Sub
    End If
    oldEnd = lo.DataBodyRange.Cells(r, ColIndex(lo, "Period end")).Value
    If IsDate(oldEnd) Then newEnd = CDate(oldEnd) Else newEnd = MonthEnd(Date)
    s = InputBox("Cut-off date (period end) of Report No " & newNo & ":", APP_TITLE, Format$(newEnd, "yyyy-mm-dd"))
    If Len(s) = 0 Then Exit Sub
    If Not IsDate(s) Then
        MsgBox "That is not a date.", vbExclamation, APP_TITLE
        Exit Sub
    End If
    newEnd = CDate(s)
    LeaveViewMode
    modUndo.Checkpoint "Edit Report No " & rn
    Busy True, "Updating Report No " & rn & "..."
    On Error GoTo fail
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Report No")).Value = newNo
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Label")).Value = "Monthly Report No " & newNo & " - " & Format$(newEnd, "mmm'yy")
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Period start")).Value = DateSerial(Year(newEnd), Month(newEnd), 1)
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Period end")).Value = newEnd
    If newNo <> rn Then
        modStore.Renumber rn, newNo
        If CurrentReportNo() = rn Then SetNamed "CurrentReportNo", newNo
        SetNamed "ViewReportNo", CurrentReportNo()
    End If
    Busy False
    Application.Calculate
    SyncPicker
    LogActivity "Report edited", "Report No " & rn & " -> No " & newNo & ", cut-off " & Format$(newEnd, "dd-mmm-yy")
    modUndo.AutoSave
    MsgBox "Report No " & newNo & " updated.", vbInformation, APP_TITLE
    Exit Sub
fail:
    Busy False
    MsgBox "Could not update the report: " & Err.Description, vbExclamation, APP_TITLE
End Sub
