Option Explicit
' ------------------------------------------------------------------------------------------
' Every report keeps its own data, as on the website. The live tables hold the report shown;
' the hidden store sheets (and the Snapshots table for Level 2) hold every report's rows.
' Switching reports saves the live rows under their report number and loads the other report.
' ------------------------------------------------------------------------------------------

Private Function StoreNames() As Variant
    StoreNames = Array("tblChanges", "tblClaims", "tblEW", "tblRisks", "tblPS", "tblBonds", "tblContracts", "tblIPC", "tblFA", "tblCashFlow", "tblTransfers", "tblActions")
End Function

' Replaces the stored rows of a report with the live rows (every register and Level 2).
Public Sub SaveLive(ByVal rn As Long)
    Dim n As Variant
    If rn <= 0 Then Exit Sub
    For Each n In StoreNames()
        SaveTable TableOf(CStr(n)), TableOf(CStr(n) & "Store"), rn
    Next n
    modPeriods.SnapshotReport rn
End Sub

' Replaces the live rows with the stored rows of a report and re-applies the calculated columns.
Public Sub LoadLive(ByVal rn As Long)
    Dim n As Variant
    If rn <= 0 Then Exit Sub
    For Each n In StoreNames()
        LoadTable TableOf(CStr(n)), TableOf(CStr(n) & "Store"), rn
    Next n
    LoadTable TableOf("tblLevel2"), TableOf("tblSnapshots"), rn
    modPeriods.ApplyAllFormulas
    modPeriods.RebuildMovement
End Sub

' True when the report has a stored cost report.
Public Function HasStored(ByVal rn As Long) As Boolean
    Dim snap As ListObject
    Set snap = TableOf("tblSnapshots")
    If snap.DataBodyRange Is Nothing Then Exit Function
    HasStored = Application.WorksheetFunction.CountIf(snap.ListColumns("Report No").DataBodyRange, rn) > 0
End Function

' Removes everything stored for a report.
Public Sub DeleteStored(ByVal rn As Long)
    Dim n As Variant
    For Each n In StoreNames()
        RemoveRows TableOf(CStr(n) & "Store"), rn
    Next n
    RemoveRows TableOf("tblSnapshots"), rn
    RemoveRows TableOf("tblLibrary"), rn
End Sub

Private Sub SaveTable(ByVal live As ListObject, ByVal store As ListObject, ByVal rn As Long)
    Dim total As Long, n As Long, existing As Variant, src As Variant, out() As Variant, keep As Long, i As Long, c As Long, cols As Long, v As Variant
    cols = store.ListColumns.Count
    total = RowCountOf(store)
    n = RowCountOf(live)
    If total > 0 Then existing = store.DataBodyRange.Value
    If n > 0 Then src = live.DataBodyRange.Value
    ReDim out(1 To total + n + 1, 1 To cols)
    For i = 1 To total
        v = existing(i, 1)
        If Not IsEmpty(v) And Not IsNull(v) Then
            If CLng(Val(CStr(v))) <> rn Then
                keep = keep + 1
                For c = 1 To cols
                    out(keep, c) = existing(i, c)
                Next c
            End If
        End If
    Next i
    For i = 1 To n
        keep = keep + 1
        out(keep, 1) = rn
        For c = 2 To cols
            out(keep, c) = src(i, c - 1)
        Next c
    Next i
    FillTable store, out, keep
End Sub

Private Sub LoadTable(ByVal live As ListObject, ByVal store As ListObject, ByVal rn As Long)
    Dim total As Long, src As Variant, out() As Variant, i As Long, c As Long, k As Long, cols As Long, v As Variant
    cols = live.ListColumns.Count
    total = RowCountOf(store)
    If total = 0 Then
        ClearTable live
        Exit Sub
    End If
    src = store.DataBodyRange.Value
    ReDim out(1 To total + 1, 1 To cols)
    For i = 1 To total
        v = src(i, 1)
        If Not IsEmpty(v) And Not IsNull(v) Then
            If CLng(Val(CStr(v))) = rn Then
                k = k + 1
                For c = 1 To cols
                    If c + 1 <= store.ListColumns.Count Then out(k, c) = src(i, c + 1)
                Next c
            End If
        End If
    Next i
    FillTable live, out, k
End Sub

Private Sub RemoveRows(ByVal store As ListObject, ByVal rn As Long)
    Dim total As Long, src As Variant, out() As Variant, i As Long, c As Long, k As Long, cols As Long, v As Variant
    cols = store.ListColumns.Count
    total = RowCountOf(store)
    If total = 0 Then Exit Sub
    src = store.DataBodyRange.Value
    ReDim out(1 To total + 1, 1 To cols)
    For i = 1 To total
        v = src(i, 1)
        If IsEmpty(v) Or IsNull(v) Then GoTo skip
        If CLng(Val(CStr(v))) = rn Then GoTo skip
        k = k + 1
        For c = 1 To cols
            out(k, c) = src(i, c)
        Next c
skip:
    Next i
    FillTable store, out, k
End Sub

' Moves everything stored under one report number to another.
Public Sub Renumber(ByVal oldNo As Long, ByVal newNo As Long)
    Dim n As Variant
    For Each n In StoreNames()
        RenumberIn TableOf(CStr(n) & "Store"), oldNo, newNo
    Next n
    RenumberIn TableOf("tblSnapshots"), oldNo, newNo
    RenumberIn TableOf("tblLibrary"), oldNo, newNo
End Sub

Private Sub RenumberIn(ByVal store As ListObject, ByVal oldNo As Long, ByVal newNo As Long)
    Dim i As Long, n As Long, col As Range
    n = RowCountOf(store)
    If n = 0 Then Exit Sub
    Set col = store.ListColumns(1).DataBodyRange
    For i = 1 To n
        If CLng(Val(CStr(Nz(col.Cells(i, 1).Value, 0)))) = oldNo Then col.Cells(i, 1).Value = newNo
    Next i
End Sub
