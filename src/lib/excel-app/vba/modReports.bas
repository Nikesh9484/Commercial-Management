Option Explicit
' ------------------------------------------------------------------------------------------
' Reports: the monthly report as a PDF, and an issued copy of the workbook
' ------------------------------------------------------------------------------------------

Public Sub ExportPdf()
    If Not IsSignedIn() Then Exit Sub
    Dim names As Variant, path As String, base As String, i As Long, vis() As String, n As Long
    names = Array("Home", "Level 1", "Level 2", "Movement", "Changes", "Claims", "Early Warnings", "Risks", "Provisional Sums", "Bonds", "Contracts", "Cash Flow", "Transfers", "Actions")
    base = DefaultFolder()
    path = SaveAsName(base & PathSep() & "Cost Report No " & CStr(NamedValue("ViewReportNo")) & " - " & FileSafe(CStr(NamedValue("ViewPeriodLabel"))) & ".pdf", "PDF (*.pdf), *.pdf", "Save the report as PDF")
    If Len(path) = 0 Then Exit Sub
    ' only the sheets this role can see
    ReDim vis(0 To UBound(names))
    n = 0
    For i = 0 To UBound(names)
        On Error Resume Next
        If ThisWorkbook.Worksheets(CStr(names(i))).Visible = xlSheetVisible Then
            vis(n) = CStr(names(i))
            n = n + 1
        End If
        On Error GoTo 0
    Next i
    If n = 0 Then Exit Sub
    ReDim Preserve vis(0 To n - 1)
    Busy True, "Exporting PDF..."
    On Error GoTo fail
    ThisWorkbook.Worksheets(vis).Select
    ActiveSheet.ExportAsFixedFormat Type:=xlTypePDF, Filename:=path, Quality:=xlQualityStandard, IncludeDocProperties:=True, IgnorePrintAreas:=False, OpenAfterPublish:=True
    ThisWorkbook.Worksheets("Home").Select
    Busy False
    LogActivity "PDF exported", path
    AddToLibrary "Cost report (PDF)", path
    Exit Sub
fail:
    Busy False
    ThisWorkbook.Worksheets("Home").Select
    MsgBox "The PDF could not be created: " & Err.Description, vbExclamation, APP_TITLE
End Sub

' Saves a copy of the workbook as the issued report of the month (values, no macros needed to read it).
Public Sub SaveIssuedCopy()
    If Not IsSignedIn() Then Exit Sub
    Dim path As Variant, base As String
    base = DefaultFolder()
    path = SaveAsName(base & PathSep() & "Commercial Dashboard - Report No " & CStr(NamedValue("CurrentReportNo")) & " (issued copy).xlsm", "Excel macro-enabled workbook (*.xlsm), *.xlsm", "Save an issued copy")
    If Len(CStr(path)) = 0 Then Exit Sub
    ThisWorkbook.SaveCopyAs CStr(path)
    LogActivity "Issued copy saved", CStr(path)
    AddToLibrary "Issued copy (Excel)", CStr(path)
    MsgBox "Issued copy saved:" & vbCrLf & path, vbInformation, APP_TITLE
End Sub

' ---- the report library (as the website's Reports & downloads page) -----------------------

Public Function FileSafe(ByVal s As String) As String
    Dim i As Long, ch As String
    For i = 1 To Len(s)
        ch = Mid$(s, i, 1)
        If InStr("\/:*?""<>|'", ch) > 0 Then ch = "-"
        FileSafe = FileSafe & ch
    Next i
End Function

Public Sub AddToLibrary(ByVal kind As String, ByVal path As String)
    On Error Resume Next
    Dim lo As ListObject, lr As ListRow
    Set lo = TableOf("tblLibrary")
    Set lr = lo.ListRows.Add(1)
    lr.Range.Cells(1, 1).Value = CLng(Nz(NamedValue("ViewReportNo"), 0))
    lr.Range.Cells(1, 2).Value = kind
    lr.Range.Cells(1, 3).Value = path
    lr.Range.Cells(1, 4).Value = Now
    lr.Range.Cells(1, 5).Value = CStr(NamedValue("SignedInUser"))
End Sub

Private Function SelectedLibraryRow(ByRef lo As ListObject) As Long
    Set lo = TableOf("tblLibrary")
    If lo.DataBodyRange Is Nothing Then Exit Function
    If ActiveSheet.Name <> "Reports" Then Exit Function
    If Intersect(ActiveCell, lo.DataBodyRange) Is Nothing Then Exit Function
    SelectedLibraryRow = ActiveCell.Row - lo.DataBodyRange.Row + 1
End Function

Public Sub OpenSelectedFile()
    If Not IsSignedIn() Then Exit Sub
    Dim lo As ListObject, r As Long, p As String
    r = SelectedLibraryRow(lo)
    If r = 0 Then
        MsgBox "Click a row of the report library first, then this button.", vbInformation, APP_TITLE
        Exit Sub
    End If
    p = CStr(Nz(lo.DataBodyRange.Cells(r, 3).Value))
    If Len(p) = 0 Then Exit Sub
    If Len(Dir(p)) = 0 Then
        MsgBox "The file is no longer where it was saved:" & vbCrLf & p, vbExclamation, APP_TITLE
        Exit Sub
    End If
    On Error Resume Next
    ThisWorkbook.FollowHyperlink p
    If Err.Number <> 0 Then MsgBox "Could not open the file: " & Err.Description, vbExclamation, APP_TITLE
End Sub

Public Sub RemoveLibraryRow()
    If Not RequireEditor() Then Exit Sub
    Dim lo As ListObject, r As Long
    r = SelectedLibraryRow(lo)
    If r = 0 Then
        MsgBox "Click a row of the report library first, then this button.", vbInformation, APP_TITLE
        Exit Sub
    End If
    If MsgBox("Remove this entry from the library? (The file itself is not deleted.)", vbQuestion + vbYesNo, APP_TITLE) <> vbYes Then Exit Sub
    lo.ListRows(r).Delete
End Sub

Public Sub OpenReportsFolder()
    On Error Resume Next
    ThisWorkbook.FollowHyperlink DefaultFolder()
    If Err.Number <> 0 Then MsgBox "The reports are saved next to this workbook: " & DefaultFolder(), vbInformation, APP_TITLE
End Sub

' ---- the library buttons: act on the report selected in the library block (else the report shown) --

Private Function LibraryReportNo() As Long
    Dim first As Range, ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets("Reports")
    Set first = ws.Range("LibraryFirstRow")
    If ActiveSheet.Name = "Reports" And Not first Is Nothing Then
        If ActiveCell.Row >= first.Row And ActiveCell.Row < first.Row + 30 Then LibraryReportNo = CLng(Val(CStr(Nz(ws.Cells(ActiveCell.Row, 1).Value))))
    End If
    If LibraryReportNo = 0 Then LibraryReportNo = CLng(Nz(NamedValue("ViewReportNo"), 0))
End Function

Private Function SwitchTo(ByVal rn As Long) As Boolean
    If rn <= 0 Then Exit Function
    If rn <> CLng(Nz(NamedValue("ViewReportNo"), 0)) Then modNav.ShowPeriod rn, True
    SwitchTo = (rn = CLng(Nz(NamedValue("ViewReportNo"), 0)))
End Function

Public Sub LibPdf()
    If Not IsSignedIn() Then Exit Sub
    If Not SwitchTo(LibraryReportNo()) Then Exit Sub
    ExportPdf
    modNav.NavReports
End Sub

Public Sub LibExcel()
    If Not IsSignedIn() Then Exit Sub
    If Not SwitchTo(LibraryReportNo()) Then Exit Sub
    SaveIssuedCopy
End Sub

Public Sub LibPpt()
    If Not IsSignedIn() Then Exit Sub
    If Not SwitchTo(LibraryReportNo()) Then Exit Sub
    modPresentation.BuildPresentation
End Sub
