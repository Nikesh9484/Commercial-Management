Option Explicit
' ------------------------------------------------------------------------------------------
' Reporting periods: new month, lock / unlock, stored copies (snapshots), calculated columns,
' and the Movement sheet
' ------------------------------------------------------------------------------------------

Public Function CurrentReportNo() As Long
    CurrentReportNo = CLng(Nz(NamedValue("CurrentReportNo"), 0))
End Function

Public Function PeriodRow(ByVal reportNo As Long) As Long
    PeriodRow = FindRow(TableOf("tblPeriods"), "Report No", CStr(reportNo))
End Function

' Stores the Level 2 lines of the current report in the Snapshots table (replacing any earlier copy of that report).
Public Sub SnapshotCurrent(Optional ByVal reason As String = "stored copy")
    Dim lo As ListObject, snap As ListObject, n As Long, i As Long, c As Long, rn As Long
    Dim src As Variant, out() As Variant, keep As Long, cols As Variant, k As Long, total As Long
    Set lo = TableOf("tblLevel2")
    Set snap = TableOf("tblSnapshots")
    rn = CurrentReportNo()
    ' rows of other reports are kept; this report's rows are replaced
    total = RowCountOf(snap)
    keep = 0
    Dim existing As Variant
    If total > 0 Then existing = snap.DataBodyRange.Value
    n = RowCountOf(lo)
    cols = Array("Code", "Package", "Name", "Category", "Section", "Budget hold", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q")
    ReDim out(1 To total + n + 1, 1 To snap.ListColumns.Count)
    For i = 1 To total
        If CLng(Nz(existing(i, 1), 0)) <> rn Then
            keep = keep + 1
            For c = 1 To snap.ListColumns.Count
                out(keep, c) = existing(i, c)
            Next c
        End If
    Next i
    If n > 0 Then
        src = lo.DataBodyRange.Value
        For i = 1 To n
            keep = keep + 1
            out(keep, 1) = rn
            For k = 0 To UBound(cols)
                out(keep, ColIndex(snap, CStr(cols(k)))) = src(i, ColIndex(lo, CStr(cols(k))))
            Next k
        Next i
    End If
    FillTable snap, out, keep
    LogActivity "Stored copy", "Report No " & rn & " – " & n & " cost lines (" & reason & ")"
End Sub

Public Sub LockCurrentPeriod()
    If Not RequireEditor() Then Exit Sub
    Dim r As Long, lo As ListObject
    Set lo = TableOf("tblPeriods")
    r = PeriodRow(CurrentReportNo())
    If r = 0 Then
        MsgBox "The current report is not in the Periods table.", vbExclamation, APP_TITLE
        Exit Sub
    End If
    If MsgBox("Lock Report No " & CurrentReportNo() & "? Its cost report is stored as the issued copy and becomes the 'previous report' for the next month's movement.", vbOKCancel + vbQuestion, APP_TITLE) <> vbOK Then Exit Sub
    Busy True, "Locking…"
    SnapshotCurrent "locked"
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Status")).Value = "Locked"
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Locked at")).Value = Now
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Locked by")).Value = CStr(NamedValue("SignedInUser"))
    Busy False
    LogActivity "Period locked", "Report No " & CurrentReportNo()
    MsgBox "Report No " & CurrentReportNo() & " is locked. Use 'New month' to start the next report.", vbInformation, APP_TITLE
End Sub

Public Sub UnlockCurrentPeriod()
    If Not RequireEditor() Then Exit Sub
    Dim r As Long, lo As ListObject
    Set lo = TableOf("tblPeriods")
    r = PeriodRow(CurrentReportNo())
    If r = 0 Then Exit Sub
    If MsgBox("Unlock Report No " & CurrentReportNo() & " so it can be changed again?", vbOKCancel + vbQuestion, APP_TITLE) <> vbOK Then Exit Sub
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Status")).Value = "Open"
    LogActivity "Period unlocked", "Report No " & CurrentReportNo()
End Sub

' Starts the next monthly report: the current report is stored (locked if it was still open), a new
' period row is added and the live registers carry on for the new month.
Public Sub NewMonth()
    If Not RequireEditor() Then Exit Sub
    Dim lo As ListObject, r As Long, rn As Long, lastEnd As Date, newEnd As Date, lr As ListRow, s As String
    Set lo = TableOf("tblPeriods")
    rn = CurrentReportNo()
    r = PeriodRow(rn)
    If r > 0 Then
        lastEnd = CDate(Nz(lo.DataBodyRange.Cells(r, ColIndex(lo, "Period end")).Value, Date))
    Else
        lastEnd = MonthEnd(Date)
    End If
    newEnd = MonthEnd(DateAdd("m", 1, lastEnd))
    s = InputBox("Cut-off date of the new report (Report No " & (rn + 1) & "):", APP_TITLE, Format$(newEnd, "yyyy-mm-dd"))
    If Len(s) = 0 Then Exit Sub
    If Not IsDate(s) Then
        MsgBox "That is not a date.", vbExclamation, APP_TITLE
        Exit Sub
    End If
    newEnd = CDate(s)
    Busy True, "Starting the new month…"
    If r > 0 Then
        SnapshotCurrent "previous report stored when the new month started"
        If LCase$(CellText(lo, r, "Status")) <> "locked" Then
            lo.DataBodyRange.Cells(r, ColIndex(lo, "Status")).Value = "Locked"
            lo.DataBodyRange.Cells(r, ColIndex(lo, "Locked at")).Value = Now
            lo.DataBodyRange.Cells(r, ColIndex(lo, "Locked by")).Value = CStr(NamedValue("SignedInUser"))
        End If
    End If
    Set lr = lo.ListRows.Add
    lr.Range.Cells(1, ColIndex(lo, "Report No")).Value = rn + 1
    lr.Range.Cells(1, ColIndex(lo, "Label")).Value = "Monthly Report No " & (rn + 1) & " – " & Format$(newEnd, "mmm'yy")
    lr.Range.Cells(1, ColIndex(lo, "Period start")).Value = DateSerial(Year(newEnd), Month(newEnd), 1)
    lr.Range.Cells(1, ColIndex(lo, "Period end")).Value = newEnd
    lr.Range.Cells(1, ColIndex(lo, "Status")).Value = "Open"
    SetNamed "CurrentReportNo", rn + 1
    SetNamed "ViewReportNo", rn + 1
    modNav.ApplyViewVisibility
    modNav.SyncPicker
    Busy False
    LogActivity "New month", "Report No " & (rn + 1) & " – cut-off " & Format$(newEnd, "dd-mmm-yy")
    MsgBox "Report No " & (rn + 1) & " started. The movement columns now compare with Report No " & rn & ".", vbInformation, APP_TITLE
End Sub

' Makes sure a period row exists for a report number (used by the monthly import).
Public Sub EnsurePeriod(ByVal reportNo As Long, ByVal periodEnd As Date, ByVal sourceFile As String)
    Dim lo As ListObject, r As Long, lr As ListRow
    Set lo = TableOf("tblPeriods")
    r = PeriodRow(reportNo)
    If r = 0 Then
        Set lr = lo.ListRows.Add
        r = RowCountOf(lo)
        lr.Range.Cells(1, ColIndex(lo, "Report No")).Value = reportNo
        lr.Range.Cells(1, ColIndex(lo, "Status")).Value = "Open"
    End If
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Label")).Value = "Monthly Report No " & reportNo & " – " & Format$(periodEnd, "mmm'yy")
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Period start")).Value = DateSerial(Year(periodEnd), Month(periodEnd), 1)
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Period end")).Value = periodEnd
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Source file")).Value = sourceFile
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Imported at")).Value = Now
    lo.DataBodyRange.Cells(r, ColIndex(lo, "Imported by")).Value = CStr(NamedValue("SignedInUser"))
End Sub

' ---- calculated columns ------------------------------------------------------------------
' The formulas live in the Formulas table on the Lists sheet (Table, Column, Formula), written by the
' dashboard when the workbook was generated, so this workbook and the website use the same rules.

Public Sub ApplyAllFormulas()
    Dim f As ListObject, i As Long, n As Long, lo As ListObject, col As String, formula As String, tbl As String
    Set f = TableOf("tblFormulas")
    n = RowCountOf(f)
    For i = 1 To n
        tbl = CellText(f, i, "Table")
        col = CellText(f, i, "Column")
        formula = CStr(Nz(f.DataBodyRange.Cells(i, ColIndex(f, "Formula")).Value))
        If Len(tbl) > 0 And Len(col) > 0 And Len(formula) > 0 Then ApplyFormula tbl, col, formula
    Next i
End Sub

Public Sub ApplyFormula(ByVal tableName As String, ByVal column As String, ByVal formula As String)
    On Error GoTo skip
    Dim lo As ListObject
    Set lo = TableOf(tableName)
    If RowCountOf(lo) = 0 Then Exit Sub
    lo.ListColumns(ColIndex(lo, column)).DataBodyRange.Formula = formula
    Exit Sub
skip:
    Debug.Print "ApplyFormula failed for " & tableName & "[" & column & "]: " & Err.Description
End Sub

' ---- Movement sheet: one row per Level 2 line, previous report vs this report ------------

Public Sub RebuildMovement()
    Dim ws As Worksheet, lo As ListObject, n As Long, i As Long, first As Long, rg As Range
    Set ws = ThisWorkbook.Worksheets("Movement")
    Set lo = TableOf("tblLevel2")
    n = RowCountOf(lo)
    ws.Unprotect SHEET_PWD
    first = CLng(ws.Range("MovementFirstRow").Value)
    ' clear the old rows
    ws.Range(ws.Cells(first, 1), ws.Cells(first + 2000, 7)).ClearContents
    ws.Range(ws.Cells(first, 1), ws.Cells(first + 2000, 7)).ClearFormats
    For i = 1 To n
        ws.Cells(first + i - 1, 1).Formula = "=INDEX(tblLevel2[Code]," & i & ")"
        ws.Cells(first + i - 1, 2).Formula = "=INDEX(tblLevel2[Name]," & i & ")"
        ws.Cells(first + i - 1, 3).Formula = "=INDEX(tblLevel2[Package]," & i & ")"
        ws.Cells(first + i - 1, 4).Formula = "=INDEX(tblLevel2[R]," & i & ")"
        ws.Cells(first + i - 1, 5).Formula = "=INDEX(tblLevel2[N]," & i & ")"
        ws.Cells(first + i - 1, 6).Formula = "=E" & (first + i - 1) & "-D" & (first + i - 1)
        ws.Cells(first + i - 1, 7).Formula = "=IF(F" & (first + i - 1) & "=0,"""",IF(D" & (first + i - 1) & "=0,""new line"",IF(E" & (first + i - 1) & "=0,""line removed"",IF(F" & (first + i - 1) & ">0,""increase"",""decrease""))))"
    Next i
    If n > 0 Then
        Set rg = ws.Range(ws.Cells(first, 1), ws.Cells(first + n - 1, 7))
        rg.Font.Size = 9
        ws.Range(ws.Cells(first, 4), ws.Cells(first + n - 1, 6)).NumberFormat = "#,##0;[Red](#,##0)"
        rg.Borders(xlInsideHorizontal).Color = RGB(217, 222, 232)
    End If
    ws.Protect Password:=SHEET_PWD, UserInterfaceOnly:=True, AllowFiltering:=True, AllowSorting:=True
End Sub
