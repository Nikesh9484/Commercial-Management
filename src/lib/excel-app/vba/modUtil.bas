Option Explicit
' ------------------------------------------------------------------------------------------
' Commercial Dashboard - Excel edition - shared helpers (tables, values, logging)
' ------------------------------------------------------------------------------------------

Public Const APP_TITLE As String = "The Marina Commercial Dashboard"
Public Const SHEET_PWD As String = "marina-dashboard"

' ---- tables ------------------------------------------------------------------------------

Public Function TableOf(ByVal tableName As String) As ListObject
    Dim ws As Worksheet, lo As ListObject
    For Each ws In ThisWorkbook.Worksheets
        For Each lo In ws.ListObjects
            If StrComp(lo.Name, tableName, vbTextCompare) = 0 Then
                Set TableOf = lo
                Exit Function
            End If
        Next lo
    Next ws
    Err.Raise vbObjectError + 100, "TableOf", "Table not found: " & tableName
End Function

Public Function ColIndex(ByVal lo As ListObject, ByVal header As String) As Long
    Dim c As ListColumn
    For Each c In lo.ListColumns
        If StrComp(c.Name, header, vbTextCompare) = 0 Then
            ColIndex = c.Index
            Exit Function
        End If
    Next c
    Err.Raise vbObjectError + 101, "ColIndex", "Column '" & header & "' not found in " & lo.Name
End Function

Public Function RowCountOf(ByVal lo As ListObject) As Long
    If lo.DataBodyRange Is Nothing Then
        RowCountOf = 0
    Else
        RowCountOf = lo.ListRows.Count
    End If
End Function

' Removes every data row (keeps the header and the formulas of calculated columns are re-applied later).
Public Sub ClearTable(ByVal lo As ListObject)
    If Not lo.DataBodyRange Is Nothing Then lo.DataBodyRange.Delete
End Sub

' Writes a 2-D array (1-based, rows x columns of the table) as the table's data rows.
Public Sub FillTable(ByVal lo As ListObject, ByRef data As Variant, ByVal rowsUsed As Long)
    Dim cols As Long
    cols = lo.ListColumns.Count
    ClearTable lo
    If rowsUsed <= 0 Then Exit Sub
    lo.Resize lo.Range.Resize(rowsUsed + 1, cols)
    Dim out() As Variant, r As Long, c As Long
    ReDim out(1 To rowsUsed, 1 To cols)
    For r = 1 To rowsUsed
        For c = 1 To cols
            out(r, c) = data(r, c)
        Next c
    Next r
    lo.DataBodyRange.Value = out
End Sub

' Appends one row given a dictionary of header -> value.
Public Function AddRow(ByVal lo As ListObject, ByVal values As Object) As ListRow
    Dim lr As ListRow, k As Variant
    Set lr = lo.ListRows.Add
    For Each k In values.Keys
        lr.Range.Cells(1, ColIndex(lo, CStr(k))).Value = values(k)
    Next k
    Set AddRow = lr
End Function

Public Function CellText(ByVal lo As ListObject, ByVal rowNo As Long, ByVal header As String) As String
    CellText = Trim$(CStr(Nz(lo.DataBodyRange.Cells(rowNo, ColIndex(lo, header)).Value)))
End Function

' First data row whose column equals the value (case-insensitive); 0 when none.
Public Function FindRow(ByVal lo As ListObject, ByVal header As String, ByVal value As String) As Long
    Dim i As Long, n As Long, c As Long
    n = RowCountOf(lo)
    If n = 0 Then Exit Function
    c = ColIndex(lo, header)
    For i = 1 To n
        If StrComp(Trim$(CStr(Nz(lo.DataBodyRange.Cells(i, c).Value))), Trim$(value), vbTextCompare) = 0 Then
            FindRow = i
            Exit Function
        End If
    Next i
End Function

' ---- values ------------------------------------------------------------------------------

Public Function Nz(ByVal v As Variant, Optional ByVal dflt As Variant = "") As Variant
    If IsError(v) Then
        Nz = dflt
    ElseIf IsNull(v) Or IsEmpty(v) Then
        Nz = dflt
    Else
        Nz = v
    End If
End Function

Public Function Txt(ByRef a As Variant, ByVal r As Long, ByVal c As Long) As String
    On Error Resume Next
    Dim v As Variant
    v = a(r, c)
    If IsError(v) Or IsEmpty(v) Or IsNull(v) Then
        Txt = ""
    Else
        Txt = Trim$(CStr(v))
    End If
End Function

Public Function IsNum(ByRef a As Variant, ByVal r As Long, ByVal c As Long) As Boolean
    On Error Resume Next
    Dim v As Variant
    v = a(r, c)
    IsNum = (VarType(v) = vbDouble Or VarType(v) = vbInteger Or VarType(v) = vbLong Or VarType(v) = vbSingle Or VarType(v) = vbCurrency)
End Function

Public Function NumOf(ByRef a As Variant, ByVal r As Long, ByVal c As Long) As Double
    On Error Resume Next
    Dim v As Variant
    v = a(r, c)
    If IsNum(a, r, c) Then
        NumOf = CDbl(v)
    ElseIf VarType(v) = vbDate Then
        NumOf = CDbl(v)
    End If
End Function

' Money cell: number, or a text such as "1,234.50" / "SAR 1,234"; Empty when not a number.
Public Function MoneyOf(ByRef a As Variant, ByVal r As Long, ByVal c As Long) As Variant
    On Error Resume Next
    Dim v As Variant, s As String
    v = a(r, c)
    If IsNum(a, r, c) Then
        MoneyOf = Round(CDbl(v), 2)
        Exit Function
    End If
    s = Txt(a, r, c)
    s = Replace(Replace(Replace(s, ",", ""), "SAR", ""), " ", "")
    If Len(s) > 0 And IsNumeric(s) Then
        MoneyOf = Round(CDbl(s), 2)
    Else
        MoneyOf = Empty
    End If
End Function

Public Function MoneyOr0(ByRef a As Variant, ByVal r As Long, ByVal c As Long) As Double
    Dim v As Variant
    v = MoneyOf(a, r, c)
    If IsEmpty(v) Then MoneyOr0 = 0 Else MoneyOr0 = CDbl(v)
End Function

' Date cell: a real date, an Excel serial, "2026-08-31", "31-Aug-26" or "31/08/2026"; Empty when not a date.
Public Function DateOf(ByRef a As Variant, ByVal r As Long, ByVal c As Long) As Variant
    On Error GoTo bad
    Dim v As Variant, s As String, d As Date
    v = a(r, c)
    DateOf = Empty
    If IsError(v) Or IsEmpty(v) Or IsNull(v) Then Exit Function
    If VarType(v) = vbDate Then
        d = CDate(v)
    ElseIf IsNum(a, r, c) Then
        If CDbl(v) < 40000 Or CDbl(v) > 50000 Then Exit Function
        d = CDate(CDbl(v))
    Else
        s = Trim$(CStr(v))
        If Len(s) = 0 Then Exit Function
        If s Like "####-##-##*" Then
            d = DateSerial(CInt(Left$(s, 4)), CInt(Mid$(s, 6, 2)), CInt(Mid$(s, 9, 2)))
        ElseIf s Like "##/##/####" Then
            d = DateSerial(CInt(Right$(s, 4)), CInt(Mid$(s, 4, 2)), CInt(Left$(s, 2)))
        ElseIf s Like "#/##/####" Then
            d = DateSerial(CInt(Right$(s, 4)), CInt(Mid$(s, 3, 2)), CInt(Left$(s, 1)))
        Else
            d = CDate(s)
        End If
    End If
    If Year(d) < 2015 Or Year(d) > 2035 Then Exit Function
    DateOf = d
    Exit Function
bad:
    DateOf = Empty
End Function

Public Function YesOf(ByRef a As Variant, ByVal r As Long, ByVal c As Long) As Boolean
    Dim s As String
    s = LCase$(Txt(a, r, c))
    YesOf = (s = "yes" Or s = "y" Or s = "true" Or s = "1" Or s = "x" Or s = "11")
End Function

Public Function YesNo(ByVal b As Boolean) As String
    If b Then YesNo = "Yes" Else YesNo = "No"
End Function

Public Function NormText(ByVal s As String) As String
    Dim i As Long, ch As String, out As String
    s = LCase$(s)
    For i = 1 To Len(s)
        ch = Mid$(s, i, 1)
        If (ch >= "a" And ch <= "z") Or (ch >= "0" And ch <= "9") Then out = out & ch
    Next i
    NormText = out
End Function

Public Function Pad(ByVal n As Long, ByVal width As Long) As String
    Pad = Right$(String(width, "0") & CStr(n), width)
End Function

Public Function IsoDate(ByVal d As Variant) As String
    If IsEmpty(d) Or IsNull(d) Then
        IsoDate = ""
    ElseIf IsDate(d) Then
        IsoDate = Format$(CDate(d), "yyyy-mm-dd")
    Else
        IsoDate = CStr(d)
    End If
End Function

' Last day of the month of a date
Public Function MonthEnd(ByVal d As Date) As Date
    MonthEnd = DateSerial(Year(d), Month(d) + 1, 0)
End Function

' ---- workbook values ---------------------------------------------------------------------

Public Function NamedValue(ByVal nm As String) As Variant
    On Error Resume Next
    NamedValue = ThisWorkbook.Names(nm).RefersToRange.Value
End Function

Public Sub SetNamed(ByVal nm As String, ByVal v As Variant)
    ThisWorkbook.Names(nm).RefersToRange.Value = v
End Sub

' ---- activity log ------------------------------------------------------------------------

Public Sub LogActivity(ByVal action As String, ByVal details As String)
    On Error Resume Next
    Dim lo As ListObject, lr As ListRow
    Set lo = TableOf("tblActivity")
    Set lr = lo.ListRows.Add(1)
    lr.Range.Cells(1, 1).Value = Now
    lr.Range.Cells(1, 2).Value = CStr(NamedValue("SignedInUser"))
    lr.Range.Cells(1, 3).Value = action
    lr.Range.Cells(1, 4).Value = Left$(details, 500)
End Sub

Public Sub Busy(ByVal isBusy As Boolean, Optional ByVal msg As String = "")
    Application.ScreenUpdating = Not isBusy
    Application.EnableEvents = Not isBusy
    If isBusy Then
        Application.Calculation = xlCalculationManual
        Application.StatusBar = msg
    Else
        Application.Calculation = xlCalculationAutomatic
        Application.StatusBar = False
    End If
End Sub

Public Function PickFile(ByVal title As String, ByVal filterDesc As String, ByVal filterExt As String) As String
    Dim fd As Object, v As Variant, app As Object
    Set app = Application
    #If Mac Then
        v = Application.GetOpenFilename(, , title)
        If VarType(v) = vbBoolean Then PickFile = "" Else PickFile = CStr(v)
    #Else
        On Error GoTo plain
        Set fd = app.FileDialog(3)
        With fd
            .Title = title
            .AllowMultiSelect = False
            .Filters.Clear
            .Filters.Add filterDesc, filterExt
            If .Show = -1 Then PickFile = .SelectedItems(1) Else PickFile = ""
        End With
        Exit Function
plain:
        v = Application.GetOpenFilename(filterDesc & " (" & filterExt & ")," & filterExt, , title)
        If VarType(v) = vbBoolean Then PickFile = "" Else PickFile = CStr(v)
    #End If
End Function

' ---- platform ------------------------------------------------------------------------------

Public Function IsMac() As Boolean
    #If Mac Then
        IsMac = True
    #End If
End Function

Public Function PathSep() As String
    PathSep = Application.PathSeparator
End Function

' The folder a save dialog starts in: next to this workbook, else the user's Documents folder.
Public Function DefaultFolder() As String
    DefaultFolder = ThisWorkbook.Path
    If Len(DefaultFolder) > 0 Then Exit Function
    #If Mac Then
        DefaultFolder = Environ$("HOME") & "/Documents"
    #Else
        DefaultFolder = Environ$("USERPROFILE") & "\Documents"
    #End If
End Function

' A "save as" dialog that works on both platforms (the Windows file filter is not understood on the Mac).
Public Function SaveAsName(ByVal initial As String, ByVal filter As String, ByVal title As String) As String
    Dim v As Variant
    #If Mac Then
        v = Application.GetSaveAsFilename(initial, , , title)
    #Else
        v = Application.GetSaveAsFilename(initial, filter, , title)
    #End If
    If VarType(v) = vbBoolean Then SaveAsName = "" Else SaveAsName = CStr(v)
End Function

' The files of a folder (full paths), then its sub-folders, without the Windows-only FileSystemObject.
Public Function FolderEntries(ByVal folder As String, ByVal subFolders As Boolean) As Collection
    Dim out As New Collection, n As String, full As String, attr As Long
    If Right$(folder, 1) <> PathSep() Then folder = folder & PathSep()
    On Error Resume Next
    n = Dir(folder, vbDirectory Or vbNormal)
    On Error GoTo 0
    Do While Len(n) > 0
        If n <> "." And n <> ".." Then
            full = folder & n
            attr = 0
            On Error Resume Next
            attr = GetAttr(full)
            On Error GoTo 0
            If ((attr And vbDirectory) <> 0) = subFolders Then out.Add full
        End If
        n = Dir()
    Loop
    Set FolderEntries = out
End Function

Public Function FileBaseName(ByVal path As String) As String
    Dim p As Long
    p = InStrRev(path, "\")
    If InStrRev(path, "/") > p Then p = InStrRev(path, "/")
    FileBaseName = Mid$(path, p + 1)
End Function
