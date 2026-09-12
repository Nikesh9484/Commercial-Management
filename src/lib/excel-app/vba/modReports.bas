Option Explicit
' ------------------------------------------------------------------------------------------
' Reports: the monthly report as a PDF, and an issued copy of the workbook
' ------------------------------------------------------------------------------------------

Public Sub ExportPdf()
    If Not IsSignedIn() Then Exit Sub
    Dim names As Variant, path As String, base As String, i As Long, vis() As String, n As Long
    names = Array("Home", "Level 1", "Level 2", "Movement", "Changes", "Claims", "Early Warnings", "Risks", "Provisional Sums", "Bonds", "Contracts", "Cash Flow", "Transfers", "Actions")
    base = ThisWorkbook.Path
    If Len(base) = 0 Then base = Environ$("USERPROFILE") & "\Documents"
    path = Application.GetSaveAsFilename(base & "\Monthly Cost Report No " & CStr(NamedValue("CurrentReportNo")) & ".pdf", "PDF (*.pdf), *.pdf", , "Save the report as PDF")
    If VarType(path) = vbBoolean Or Len(path) = 0 Then Exit Sub
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
    Busy True, "Exporting PDF…"
    On Error GoTo fail
    ThisWorkbook.Worksheets(vis).Select
    ActiveSheet.ExportAsFixedFormat Type:=xlTypePDF, Filename:=path, Quality:=xlQualityStandard, IncludeDocProperties:=True, IgnorePrintAreas:=False, OpenAfterPublish:=True
    ThisWorkbook.Worksheets("Home").Select
    Busy False
    LogActivity "PDF exported", path
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
    base = ThisWorkbook.Path
    If Len(base) = 0 Then base = Environ$("USERPROFILE") & "\Documents"
    path = Application.GetSaveAsFilename(base & "\Commercial Dashboard – Report No " & CStr(NamedValue("CurrentReportNo")) & " (issued copy).xlsm", "Excel macro-enabled workbook (*.xlsm), *.xlsm", , "Save an issued copy")
    If VarType(path) = vbBoolean Or Len(CStr(path)) = 0 Then Exit Sub
    ThisWorkbook.SaveCopyAs CStr(path)
    LogActivity "Issued copy saved", CStr(path)
    MsgBox "Issued copy saved:" & vbCrLf & path, vbInformation, APP_TITLE
End Sub
