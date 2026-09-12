Option Explicit
' ------------------------------------------------------------------------------------------
' Autosave and undo. Before every step (an import, a new month, a lock, a deletion, a user
' change) the workbook keeps a copy of itself in a "backups" folder next to the file; "Undo step"
' brings the last copy back. Every step saves the workbook; a cell entry saves it a few seconds
' later. "Undo entry" is Excel's own undo for the last cell entry.
' ------------------------------------------------------------------------------------------

Private Const KEEP_BACKUPS As Long = 15
Private nextSave As Date
Private savePending As Boolean

' ---- checkpoints -----------------------------------------------------------------------------

' Keeps a copy of the workbook as it is now, so the step about to run can be undone.
Public Sub Checkpoint(ByVal action As String)
    On Error GoTo quiet
    If Len(ThisWorkbook.Path) = 0 Then Exit Sub
    Dim folder As String, file As String, lo As ListObject, lr As ListRow, stepNo As Long
    folder = BackupFolder()
    If Len(Dir(folder, vbDirectory)) = 0 Then MkDir folder
    Set lo = TableOf("tblUndo")
    stepNo = 1
    If RowCountOf(lo) > 0 Then stepNo = CLng(Val(CellText(lo, 1, "Step"))) + 1
    file = folder & PathSep() & "Step " & Format$(stepNo, "0000") & " - before " & modReports.FileSafe(action) & " - " & Format$(Now, "yyyy-mm-dd hh-mm-ss") & ".xlsm"
    Application.DisplayAlerts = False
    ThisWorkbook.SaveCopyAs file
    Application.DisplayAlerts = True
    Set lr = lo.ListRows.Add(1)
    lr.Range.Cells(1, ColIndex(lo, "Step")).Value = stepNo
    lr.Range.Cells(1, ColIndex(lo, "Action")).Value = action
    lr.Range.Cells(1, ColIndex(lo, "When")).Value = Now
    lr.Range.Cells(1, ColIndex(lo, "By")).Value = CStr(NamedValue("SignedInUser"))
    lr.Range.Cells(1, ColIndex(lo, "File")).Value = file
    TrimBackups lo
    Exit Sub
quiet:
    Application.DisplayAlerts = True
End Sub

Private Function BackupFolder() As String
    Dim base As String
    base = ThisWorkbook.Name
    If InStrRev(base, ".") > 0 Then base = Left$(base, InStrRev(base, ".") - 1)
    BackupFolder = ThisWorkbook.Path & PathSep() & base & " backups"
End Function

Private Sub TrimBackups(ByVal lo As ListObject)
    On Error Resume Next
    Do While RowCountOf(lo) > KEEP_BACKUPS
        Kill CellText(lo, RowCountOf(lo), "File")
        lo.ListRows(RowCountOf(lo)).Delete
    Loop
End Sub

' ---- undo a step -----------------------------------------------------------------------------

' Brings back the copy kept before the last step: the copy opens, closes this workbook and saves
' itself under this workbook's name.
Public Sub UndoStep()
    If Not IsSignedIn() Then Exit Sub
    Dim lo As ListObject, file As String, action As String, whenTxt As String, bk As Workbook
    Set lo = TableOf("tblUndo")
    If RowCountOf(lo) = 0 Then
        MsgBox "There is no step to undo yet. A step is an import, a new month, a lock or unlock, a deleted report or a user change. For a cell you just typed, use 'Undo entry'.", vbInformation, APP_TITLE
        Exit Sub
    End If
    file = CellText(lo, 1, "File")
    action = CellText(lo, 1, "Action")
    whenTxt = Format$(CDate(Nz(lo.DataBodyRange.Cells(1, ColIndex(lo, "When")).Value, Now)), "dd-mmm hh:nn")
    If Len(Dir(file)) = 0 Then
        MsgBox "The copy kept before '" & action & "' is no longer there:" & vbCrLf & file, vbExclamation, APP_TITLE
        Exit Sub
    End If
    If MsgBox("Undo '" & action & "' (" & whenTxt & ")?" & vbCrLf & vbCrLf & "The workbook goes back to exactly how it was just before that step. Everything done since then is lost. You will be asked to sign in again.", vbYesNo + vbExclamation, APP_TITLE) <> vbYes Then Exit Sub
    On Error GoTo fail
    Application.EnableEvents = False
    Application.DisplayAlerts = False
    Set bk = Workbooks.Open(file)
    Application.EnableEvents = True
    ' the copy takes over once this macro has finished
    bk.Worksheets("Setup").Range("RestoreTarget").Value = ThisWorkbook.FullName
    bk.Worksheets("Setup").Range("RestoreSource").Value = ThisWorkbook.Name
    Application.OnTime Now + TimeSerial(0, 0, 1), "'" & bk.Name & "'!modUndo.RestoreDeferred"
    Exit Sub
fail:
    Application.EnableEvents = True
    Application.DisplayAlerts = True
    MsgBox "Could not open the copy: " & Err.Description, vbExclamation, APP_TITLE
End Sub

' Runs inside the opened copy: closes the original and saves this copy under the original's name.
Public Sub RestoreDeferred()
    Dim target As String, source As String, ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets("Setup")
    target = CStr(Nz(ws.Range("RestoreTarget").Value))
    source = CStr(Nz(ws.Range("RestoreSource").Value))
    If Len(target) = 0 Then Exit Sub
    Application.DisplayAlerts = False
    Application.EnableEvents = False
    Workbooks(source).Close SaveChanges:=False
    ws.Range("RestoreTarget").Value = ""
    ws.Range("RestoreSource").Value = ""
    ThisWorkbook.SaveAs Filename:=target, FileFormat:=52
    Application.EnableEvents = True
    Application.DisplayAlerts = True
    LogActivity "Undo step", "Restored from " & ThisWorkbook.Name
    modMain.AppStart
    MsgBox "The step was undone. Please sign in again.", vbInformation, APP_TITLE
End Sub

' Excel's own undo of the last cell entry (only while no step has run since).
Public Sub UndoEntry()
    On Error GoTo none
    Application.Undo
    Exit Sub
none:
    MsgBox "Nothing to undo for a cell entry. To undo the last step (import, new month, lock, delete, user change) use 'Undo step'.", vbInformation, APP_TITLE
End Sub

' ---- autosave -------------------------------------------------------------------------------

' Saves the workbook now (after a step).
Public Sub AutoSave()
    On Error Resume Next
    If Len(ThisWorkbook.Path) = 0 Or ThisWorkbook.ReadOnly Then Exit Sub
    Application.DisplayAlerts = False
    ThisWorkbook.Save
    Application.DisplayAlerts = True
End Sub

' A cell was entered: save a few seconds later (one save for a burst of entries).
Public Sub EntryChanged()
    On Error Resume Next
    If savePending Then Application.OnTime nextSave, "modUndo.AutoSaveNow", , False
    nextSave = Now + TimeSerial(0, 0, 4)
    savePending = True
    Application.OnTime nextSave, "modUndo.AutoSaveNow"
End Sub

Public Sub AutoSaveNow()
    savePending = False
    AutoSave
End Sub
