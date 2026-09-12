Option Explicit
' ------------------------------------------------------------------------------------------
' Imports of the two known report layouts:
'   - "The Marina CM Report" monthly workbook (Schedule B / C / D / F / H / J, Early Warning, Data Input)
'   - the AMAALA CM Claims Tracker (AMA-CM-FRM-0018)
' Every rule mirrors the website's converter: DVO / PVO amounts feed H / J, early warnings feed L,
' RFC amounts are tracker amounts (K = 0), claims come only from the Claims Tracker, and each
' cost category gets a budget-hold line so Level 1 stays at the approved budget.
' ------------------------------------------------------------------------------------------

' ---- canonical names -------------------------------------------------------------------

Public Function CanonicalContractor(ByVal name As String) As String
    Dim n As String
    n = LCase$(Trim$(name))
    CanonicalContractor = Trim$(name)
    If Len(n) = 0 Then Exit Function
    If InStr(n, "al saad") > 0 Or InStr(n, "alsaad") > 0 Or InStr(n, "als -") > 0 Or InStr(n, "als-") > 0 Then CanonicalContractor = "Al Saad General Contracting Co. Ltd."
    If InStr(n, "mme") > 0 Or InStr(n, "majestic marine") > 0 Or InStr(n, "ps-mmemarine") > 0 Then CanonicalContractor = "MME - Majestic Marine Engineering LLC"
    If InStr(n, "wsp") > 0 Then CanonicalContractor = "WSP Middle East"
    If InStr(n, "elmar") > 0 Then CanonicalContractor = "Elmar Marinas Khaleej LLC"
    If InStr(n, "five ocean") > 0 Or InStr(n, "5 ocean") > 0 Then CanonicalContractor = "Five Oceans Environmental Services LLC"
    If InStr(n, "beacon") > 0 Or InStr(n, "becon") > 0 Then CanonicalContractor = "Beacon Development Company"
    If InStr(n, "jvd") > 0 Or InStr(n, "dredging int") > 0 Then CanonicalContractor = "Dredging International Saudi Arabia (JVD)"
    If InStr(n, "haskoning") > 0 Then CanonicalContractor = "Haskoning DHV Saudia"
    If InStr(n, "kaust") > 0 Or InStr(n, "king abdullah") > 0 Then CanonicalContractor = "KAUST - King Abdullah University of Science & Technology"
    If InStr(n, "sydney sea") > 0 Or InStr(n, "sys-sydney") > 0 Then CanonicalContractor = "Sydney Seaplanes Asia Limited"
    If InStr(n, "supreme rubber") > 0 Then CanonicalContractor = "Supreme Rubber LLC"
    If InStr(n, "al rajhi") > 0 Then CanonicalContractor = "Al Rajhi Takaful (insurance)"
    If InStr(n, "foster") > 0 Then CanonicalContractor = "Foster + Partners"
End Function

Public Function CanonicalPackage(ByVal name As String) As String
    Dim n As String
    n = Trim$(name)
    Do While InStr(n, "  ") > 0
        n = Replace(n, "  ", " ")
    Loop
    CanonicalPackage = n
    Select Case LCase$(n)
        Case "marina basin": CanonicalPackage = "Al Saad Main Works"
        Case "fixed decks": CanonicalPackage = "ALS - Construction of Jetty Works"
        Case "professional services": CanonicalPackage = "WSP Consultants"
        Case "design and construction of floating pontoons": CanonicalPackage = "MME-MME Marine Engg"
        Case "constructing boardwalks & jetties for hijaz island": CanonicalPackage = "Elmar-Hijaz Boardwalk and Jetties"
        Case "water aerodrome feasibility study for a water aerodrome": CanonicalPackage = "Sydney SeaPlane"
        Case "call-off agreement for group level environmental consultancy services": CanonicalPackage = "Kaust-King Abdullah University of Science"
        Case "ps - ground improvement to enhance shoring system": CanonicalPackage = "PS - enhance shoring system"
        Case "supreme rubber - marine furniture": CanonicalPackage = "Supreme Rubber - Marine Furniture"
    End Select
End Function

Private Function BondType(ByVal t As String) As String
    Select Case LCase$(Trim$(t))
        Case "trade license": BondType = "Trade License"
        Case "professional indemnity": BondType = "Professional Indemnity"
        Case "public liability", "third party liability": BondType = "Public/Third Party Liability"
        Case "contractors all risk": BondType = "Contractors All Risks"
        Case "advance payment bond": BondType = "Advance Payment Bond"
        Case "performance bond": BondType = "Performance Bond"
        Case "workmens compensation", "workmen's compensation", "workmen's compensation": BondType = "Workmen's Compensation"
        Case "motor vehicle", "motor vehicle insurance": BondType = "Motor Vehicle Liability"
        Case "contractor's plant & machinery policy": BondType = "Plant & Equipment"
        Case "marine hull": BondType = "Marine & Hull"
        Case "protection and indemnity": BondType = "Protection & Indemnity"
        Case Else: BondType = Trim$(t)
    End Select
End Function

' ---- sheet helpers -----------------------------------------------------------------------

Private Function SheetNamed(ByVal wb As Workbook, ParamArray names() As Variant) As Worksheet
    Dim ws As Worksheet, i As Long
    For i = LBound(names) To UBound(names)
        For Each ws In wb.Worksheets
            If NormText(ws.Name) = NormText(CStr(names(i))) Then
                Set SheetNamed = ws
                Exit Function
            End If
        Next ws
    Next i
End Function

Private Function Grid(ByVal ws As Worksheet) As Variant
    ' the sheet's values as a 1-based array whose indexes are the real row / column numbers
    Dim a As Variant, rows As Long, cols As Long
    rows = ws.UsedRange.Row + ws.UsedRange.Rows.Count - 1
    cols = ws.UsedRange.Column + ws.UsedRange.Columns.Count - 1
    If rows < 2 Then rows = 2
    If cols < 2 Then cols = 2
    a = ws.Range(ws.Cells(1, 1), ws.Cells(rows, cols)).Value
    Grid = a
End Function

' First row whose cells (joined) contain all the words.
Private Function HeaderRowWith(ByRef a As Variant, ByVal dflt As Long, ParamArray words() As Variant) As Long
    Dim r As Long, c As Long, joined As String, i As Long, ok As Boolean
    For r = 1 To UBound(a, 1)
        joined = ""
        For c = 1 To UBound(a, 2)
            joined = joined & " | " & LCase$(Txt(a, r, c))
        Next c
        ok = True
        For i = LBound(words) To UBound(words)
            If InStr(joined, LCase$(CStr(words(i)))) = 0 Then ok = False
        Next i
        If ok Then
            HeaderRowWith = r
            Exit Function
        End If
    Next r
    HeaderRowWith = dflt
End Function

Private Function StartsWith(ByVal s As String, ByVal p As String) As Boolean
    StartsWith = (StrComp(Left$(s, Len(p)), p, vbTextCompare) = 0)
End Function

' "CN.031C02-2" -> "031C02"; "PS.031D03" -> "031D03"
Private Function FragOf(ByVal code As String) As String
    Dim s As String, i As Long
    s = UCase$(code)
    For i = 1 To Len(s) - 5
        If Mid$(s, i, 6) Like "###[A-Z]##" Then
            FragOf = Mid$(s, i, 6)
            Exit Function
        End If
    Next i
End Function

Private Function StageStatus(ByVal s As String) As String
    Select Case UCase$(Trim$(s))
        Case "APPROVED": StageStatus = "Approved"
        Case "CANCELLED": StageStatus = "Cancelled"
        Case "SUPERSEDED": StageStatus = "Superseded"
        Case "REVIEW COMPLETE": StageStatus = "Review Complete"
        Case "REJECTED": StageStatus = "Rejected"
        Case "PENDING": StageStatus = "Pending"
        Case "": StageStatus = ""
        Case Else: StageStatus = UCase$(Left$(Trim$(s), 1)) & LCase$(Mid$(Trim$(s), 2))
    End Select
End Function

Private Function TimeImpact(ByRef a As Variant, ByVal r As Long, ByVal c As Long) As Variant
    If IsNum(a, r, c) Then
        TimeImpact = NumOf(a, r, c)
    ElseIf UCase$(Txt(a, r, c)) = "NO" Then
        TimeImpact = 0
    Else
        TimeImpact = Empty
    End If
End Function

' ---- the monthly report --------------------------------------------------------------------

Private presetReportNo As Long

' Library: re-import (replace) the selected report from its file.
Public Sub ImportMonthlyReportFor(ByVal rn As Long)
    presetReportNo = rn
    ImportMonthlyReport
    presetReportNo = 0
End Sub

Public Sub ImportMonthlyReport()
    If Not RequireEditor() Then Exit Sub
    Dim path As String, wb As Workbook
    path = PickFile("Choose the monthly cost report workbook (The Marina CM Report layout)", "Excel workbooks", "*.xlsx;*.xlsm;*.xls")
    If Len(path) = 0 Then Exit Sub
    Busy True, "Opening " & path & "..."
    On Error GoTo fail
    Set wb = Workbooks.Open(path, ReadOnly:=True, UpdateLinks:=0)
    If SheetNamed(wb, "Schedule B") Is Nothing Or SheetNamed(wb, "Schedule C") Is Nothing Then
        wb.Close False
        Busy False
        MsgBox "This workbook does not look like the monthly cost report (no 'Schedule B' and 'Schedule C' sheets).", vbExclamation, APP_TITLE
        Exit Sub
    End If
    ' report number and period from Data Input
    Dim reportNo As Long, periodEnd As Date, asset As String, di As Worksheet, a As Variant, r As Long, lbl As String, s As String, mo As Long, yr As Long, p As Long
    periodEnd = MonthEnd(Date)
    Set di = SheetNamed(wb, "Data Input")
    If Not di Is Nothing Then
        a = Grid(di)
        For r = 1 To UBound(a, 1)
            lbl = UCase$(Txt(a, r, 1))
            If StartsWith(lbl, "ASSET CODE") Then asset = Txt(a, r, 2)
            If StartsWith(lbl, "REPORT NO") Then
                s = Txt(a, r, 2)
                For p = 1 To Len(s)
                    If Mid$(s, p, 1) Like "#" Then
                        reportNo = CLng(Val(Mid$(s, p)))
                        Exit For
                    End If
                Next p
            End If
            If StartsWith(lbl, "REPORTING PERIOD") Then
                s = Txt(a, r, 2)
                mo = MonthFromText(s)
                yr = YearFromText(s)
                If mo > 0 And yr > 0 Then periodEnd = DateSerial(yr, mo + 1, 0)
            End If
        Next r
    End If
    If Len(asset) = 0 Then asset = CStr(Nz(NamedValue("AssetCode")))
    Busy False
    Dim cur As Long, msg As String
    cur = CurrentReportNo()
    If presetReportNo > 0 Then reportNo = presetReportNo
    s = InputBox("Report number for this import" & vbLf & "(the file says " & IIf(reportNo > 0, "No " & reportNo, "nothing") & "; the current report is No " & cur & ")", APP_TITLE, CStr(IIf(reportNo > 0, reportNo, cur + 1)))
    If Len(s) = 0 Then GoTo closeQuiet
    reportNo = CLng(Val(s))
    If reportNo <= 0 Then GoTo closeQuiet
    s = InputBox("Cut-off date (period end) of Report No " & reportNo & ":", APP_TITLE, Format$(periodEnd, "yyyy-mm-dd"))
    If Len(s) = 0 Then GoTo closeQuiet
    If Not IsDate(s) Then
        MsgBox "That is not a date.", vbExclamation, APP_TITLE
        GoTo closeQuiet
    End If
    periodEnd = CDate(s)
    If reportNo = cur Then
        msg = "Re-import Report No " & reportNo & " (cut-off " & Format$(periodEnd, "dd-mmm-yy") & ")? Its cost lines, changes, early warnings, risks, provisional sums, contracts, IPC log and budget transfers are replaced. Claims, bonds and final accounts are not touched."
    ElseIf reportNo > cur Then
        msg = "Import Report No " & reportNo & " (cut-off " & Format$(periodEnd, "dd-mmm-yy") & ") as the new current report? Report No " & cur & " is stored first as an issued report."
    Else
        msg = "Import Report No " & reportNo & " (cut-off " & Format$(periodEnd, "dd-mmm-yy") & ") as an earlier issued report? It is stored on its own and can be shown from the Periods page; the current report (No " & cur & ") stays live."
    End If
    If MsgBox(msg, vbOKCancel + vbQuestion, APP_TITLE) <> vbOK Then GoTo closeQuiet
    modNav.EnsureCurrentView
    modUndo.Checkpoint "Import monthly report No " & reportNo
    Busy True, "Importing Report No " & reportNo & "..."
    On Error GoTo fail
    If cur > 0 Then modStore.SaveLive cur
    If reportNo > cur And cur > 0 Then
        Dim lp As ListObject, pr As Long
        Set lp = TableOf("tblPeriods")
        pr = PeriodRow(cur)
        If pr > 0 Then
            If LCase$(CellText(lp, pr, "Status")) <> "locked" Then
                lp.DataBodyRange.Cells(pr, ColIndex(lp, "Status")).Value = "Locked"
                lp.DataBodyRange.Cells(pr, ColIndex(lp, "Locked at")).Value = Now
                lp.DataBodyRange.Cells(pr, ColIndex(lp, "Locked by")).Value = CStr(NamedValue("SignedInUser"))
            End If
        End If
    End If
    EnsurePeriod reportNo, periodEnd, FileBaseName(path), IIf(reportNo < cur, "Locked", "Open")
    If reportNo >= cur Then SetNamed "CurrentReportNo", reportNo
    Dim summary As String
    summary = ImportCostLines(wb, asset)
    summary = summary & vbCrLf & ImportContractsAndIpcs(wb, periodEnd)
    summary = summary & vbCrLf & ImportChanges(wb, asset)
    summary = summary & vbCrLf & ImportEarlyWarnings(wb, periodEnd)
    summary = summary & vbCrLf & ImportRisks(wb, periodEnd)
    summary = summary & vbCrLf & ImportProvisionalSums(wb)
    summary = summary & vbCrLf & ImportTransfers(wb, periodEnd)
    wb.Close False
    Set wb = Nothing
    ApplyAllFormulas
    RebuildMovement
    modStore.SaveLive reportNo
    If reportNo < cur Then
        modStore.LoadLive cur
        SetNamed "ViewReportNo", cur
    Else
        SetNamed "ViewReportNo", reportNo
    End If
    modNav.SyncPicker
    Busy False
    Application.Calculate
    LogActivity "Monthly report imported", "Report No " & reportNo & " from " & path
    KeepImportedFile path, "Report No " & reportNo
    modUndo.AutoSave
    MsgBox "Report No " & reportNo & " imported and stored." & vbCrLf & vbCrLf & summary & IIf(reportNo < cur, vbCrLf & vbCrLf & "Choose it in the gold box on Home or on the Periods page to see it.", ""), vbInformation, APP_TITLE
    Exit Sub
closeQuiet:
    On Error Resume Next
    wb.Close False
    Busy False
    Exit Sub
fail:
    Busy False
    On Error Resume Next
    If Not wb Is Nothing Then wb.Close False
    MsgBox "The import stopped: " & Err.Description & vbCrLf & "Nothing else was changed; use 'Recalculate' if the tables look incomplete.", vbExclamation, APP_TITLE
End Sub

Private Function MonthFromText(ByVal s As String) As Long
    Dim names As Variant, i As Long
    names = Array("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
    For i = 0 To 11
        If InStr(1, LCase$(s), CStr(names(i))) > 0 Then
            MonthFromText = i + 1
            Exit Function
        End If
    Next i
End Function

Private Function YearFromText(ByVal s As String) As Long
    Dim i As Long
    For i = 1 To Len(s) - 3
        If Mid$(s, i, 4) Like "20##" Then
            YearFromText = CLng(Mid$(s, i, 4))
            Exit Function
        End If
    Next i
End Function

Private Function CategoryOf(ByVal code As String, ByVal inEarlyWorks As Boolean) As String
    If StartsWith(code, "PS") Then
        CategoryOf = "Professional Services"
    ElseIf StartsWith(code, "MS") Then
        CategoryOf = "Management Supervision"
    ElseIf StartsWith(code, "CM") Then
        CategoryOf = "Commercial Management"
    ElseIf inEarlyWorks Or code = "CN.031C01" Then
        CategoryOf = "Early Works"
    Else
        CategoryOf = "Construction Works"
    End If
End Function

' Schedule B -> tblLevel2. Returns a summary line.
Private Function ImportCostLines(ByVal wb As Workbook, ByVal asset As String) As String
    Dim ws As Worksheet, a As Variant, hdr As Long, r As Long, code As String, pk As String, nm As String, contr As String, up As String
    Dim inEW As Boolean, hold As Boolean, baseline As Double, transfers As Double, awarded As Double, n As Long, seen As Object, cnt As Long, ucode As String
    Dim lo As ListObject, out() As Variant, cols As Long, afterTotal As Boolean, grandSeen As Boolean
    Set ws = SheetNamed(wb, "Schedule B")
    Set lo = TableOf("tblLevel2")
    If ws Is Nothing Then
        ImportCostLines = "Schedule B not found - cost lines unchanged."
        Exit Function
    End If
    Set seen = New Dict
    a = Grid(ws)
    hdr = HeaderRowWith(a, 12, "code", "package", "approved baseline budget")
    cols = lo.ListColumns.Count
    ReDim out(1 To UBound(a, 1) + 5, 1 To cols)
    For r = hdr + 1 To UBound(a, 1)
        code = Txt(a, r, 1)
        pk = Txt(a, r, 2)
        nm = Txt(a, r, 3)
        contr = Txt(a, r, 4)
        up = UCase$(nm)
        If InStr(up, "EARLY WORKS") > 0 And (code = "CN - EW" Or StartsWith(up, "SUB-TOTAL")) Then inEW = False
        If Len(code) = 0 And InStr(up, "EARLY WORKS") > 0 Then inEW = True
        If StartsWith(up, "GRAND TOTAL") And code = asset And n > 0 Then Exit For
        If Len(code) = 0 And Len(nm) = 0 Then GoTo nextRow
        If StartsWith(up, "SUB-TOTAL") Or StartsWith(up, "SUB TOTAL") Or StartsWith(up, "TOTAL") Or StartsWith(up, "GRAND TOTAL") Then GoTo nextRow
        If (code = "PS" Or code = "CN - EW" Or code = "CN - MW" Or code = "CC" Or code = "FF&E & OS&E" Or code = "98" Or code = "MS.98 + CM.98" Or code = "CN.98" Or code = "PS.98" Or code = asset) And Not StartsWith(up, "REMAINING") Then GoTo nextRow
        If Len(code) = 0 Then GoTo nextRow
        hold = (Right$(code, 3) = ".98") Or StartsWith(up, "REMAINING BUDGET")
        If Len(pk) = 0 And Len(contr) = 0 And Not hold Then GoTo nextRow
        baseline = MoneyOr0(a, r, 5)
        transfers = MoneyOr0(a, r, 6)
        awarded = MoneyOr0(a, r, 8)
        If seen.Exists(code) Then
            cnt = seen(code) + 1
            seen(code) = cnt
            ucode = code & "-" & cnt
        Else
            seen.Add code, 1
            ucode = code
        End If
        n = n + 1
        out(n, ColIndex(lo, "Code")) = ucode
        If hold Then out(n, ColIndex(lo, "Package")) = "Budget Hold" Else out(n, ColIndex(lo, "Package")) = CanonicalPackage(IIf(Len(pk) > 0, pk, Left$(nm, 40)))
        out(n, ColIndex(lo, "Name")) = IIf(Len(nm) > 0, nm, pk)
        out(n, ColIndex(lo, "Contractor")) = IIf(Len(contr) > 0, CanonicalContractor(contr), "")
        out(n, ColIndex(lo, "Section")) = IIf(hold Or awarded = 0, "Uncommitted", "Committed")
        out(n, ColIndex(lo, "Category")) = CategoryOf(code, inEW)
        out(n, ColIndex(lo, "Budget hold")) = YesNo(hold)
        out(n, ColIndex(lo, "Order")) = n
        out(n, ColIndex(lo, "E")) = baseline
        out(n, ColIndex(lo, "Opening transfers")) = transfers
        out(n, ColIndex(lo, "Notes")) = IIf(hold, "Budget hold - remaining budget not yet allocated to a contract", IIf(ucode <> code, "Excel code " & code & " (shared with other lines)", ""))
nextRow:
    Next r
    ' the budget-hold block sits below the asset grand total
    afterTotal = False
    For r = hdr + 1 To UBound(a, 1)
        code = Txt(a, r, 1)
        up = UCase$(Txt(a, r, 3))
        If StartsWith(up, "GRAND TOTAL") And code = asset Then
            afterTotal = Not afterTotal
            GoTo nextRow2
        End If
        If Not afterTotal Then GoTo nextRow2
        If Right$(code, 3) <> ".98" Or Not StartsWith(up, "REMAINING") Then GoTo nextRow2
        If seen.Exists(code) Then GoTo nextRow2
        seen.Add code, 1
        n = n + 1
        out(n, ColIndex(lo, "Code")) = code
        out(n, ColIndex(lo, "Package")) = "Budget Hold"
        out(n, ColIndex(lo, "Name")) = Txt(a, r, 3)
        out(n, ColIndex(lo, "Contractor")) = ""
        out(n, ColIndex(lo, "Section")) = "Uncommitted"
        out(n, ColIndex(lo, "Category")) = CategoryOf(code, False)
        out(n, ColIndex(lo, "Budget hold")) = "Yes"
        out(n, ColIndex(lo, "Order")) = n
        out(n, ColIndex(lo, "E")) = MoneyOr0(a, r, 5)
        out(n, ColIndex(lo, "Opening transfers")) = MoneyOr0(a, r, 6)
        out(n, ColIndex(lo, "Notes")) = "Budget hold - remaining budget not yet allocated to a contract"
nextRow2:
    Next r
    FillTable lo, out, n
    ImportCostLines = "Cost lines: " & n
End Function

' The cost line for a package (first line of that package) or a contract code fragment.
Private Function LineForPackage(ByVal pk As String) As String
    Dim lo As ListObject, i As Long, n As Long, want As String, c As Long
    Set lo = TableOf("tblLevel2")
    n = RowCountOf(lo)
    want = CanonicalPackage(pk)
    If n = 0 Or Len(want) = 0 Then Exit Function
    c = ColIndex(lo, "Package")
    For i = 1 To n
        If StrComp(Trim$(CStr(Nz(lo.DataBodyRange.Cells(i, c).Value))), want, vbTextCompare) = 0 Then
            LineForPackage = CStr(lo.DataBodyRange.Cells(i, ColIndex(lo, "Code")).Value)
            Exit Function
        End If
    Next i
End Function

Private Function LineForFrag(ByVal frag As String) As String
    Dim lo As ListObject, i As Long, n As Long, code As String
    Set lo = TableOf("tblLevel2")
    n = RowCountOf(lo)
    If n = 0 Or Len(frag) = 0 Then Exit Function
    For i = 1 To n
        code = CStr(lo.DataBodyRange.Cells(i, ColIndex(lo, "Code")).Value)
        If FragOf(code) = UCase$(frag) Then
            LineForFrag = code
            Exit Function
        End If
    Next i
End Function

Private Function PackageOfLine(ByVal code As String) As String
    Dim lo As ListObject, r As Long
    Set lo = TableOf("tblLevel2")
    r = FindRow(lo, "Code", code)
    If r > 0 Then PackageOfLine = CellText(lo, r, "Package")
End Function

' Schedule H (contracts) + "Schedule H - ..." IPC logs -> tblContracts / tblIPC
Private Function ImportContractsAndIpcs(ByVal wb As Workbook, ByVal periodEnd As Date) As String
    Dim H As Worksheet, a As Variant, hdr As Long, r As Long, loC As ListObject, loI As ListObject, outC() As Variant, nC As Long
    Dim acc As String, scope As String, line As String, po As String, ws As Worksheet, ipcSheets As Collection, s As Variant
    Set loC = TableOf("tblContracts")
    Set loI = TableOf("tblIPC")
    Set H = SheetNamed(wb, "Schedule H")
    ReDim outC(1 To 400, 1 To loC.ListColumns.Count)
    Dim paramsBy As Object, fragBy As Object, engFragBy As Object
    Set paramsBy = New Dict
    Set fragBy = New Dict
    Set engFragBy = New Dict
    ' the per-contract IPC sheets and their layout
    Set ipcSheets = New Collection
    For Each ws In wb.Worksheets
        If (LCase$(Left$(Trim$(ws.Name), 11)) = "schedule h " Or LCase$(Left$(Trim$(ws.Name), 11)) = "schedule h-") And NormText(ws.Name) <> "scheduleh" Then ipcSheets.Add ws
    Next ws
    Dim ia As Variant, ih As Long, layoutA As Boolean, adv As Long, ret As Long, vat As Long, ipcDays As Long, payDays As Long, vatCell As Variant
    For Each s In ipcSheets
        Set ws = s
        ia = Grid(ws)
        ih = HeaderRowWith(ia, 11, "sr nr", "payment applicat")
        layoutA = StartsWith(UCase$(Txt(ia, ih, 12)), "IPC NR")
        adv = 0
        ret = 0
        If layoutA Then
            adv = CLng(Round(NumOf(ia, ih + 1, 8) * 100))
            ret = CLng(Round(NumOf(ia, ih + 1, 9) * 100))
        End If
        vat = 15
        If layoutA Then vatCell = MoneyOf(ia, ih + 1, 29) Else vatCell = MoneyOf(ia, ih + 1, 26)
        If Not IsEmpty(vatCell) Then vat = CLng(Round(CDbl(vatCell) * 100))
        ipcDays = DaysFromRule(Txt(ia, ih + 2, IIf(layoutA, 13, 10)), 28)
        payDays = DaysFromRule(Txt(ia, ih + 2, IIf(layoutA, 24, 21)), 30)
        paramsBy.Add ws.Name, Array(layoutA, ih, adv, ret, vat, ipcDays, payDays)
        fragBy.Add ws.Name, FindFragIn(ia, ih, IIf(layoutA, Array(4, 23), Array(4, 20)))
        engFragBy.Add ws.Name, FindFragIn(ia, ih, IIf(layoutA, Array(13), Array(10)))
    Next s
    ' contracts
    Dim contractByFrag As Object
    Set contractByFrag = New Dict
    If Not H Is Nothing Then
        a = Grid(H)
        hdr = HeaderRowWith(a, 11, "sr nr", "name", "original contract")
        For r = hdr + 1 To UBound(a, 1)
            If Not IsNum(a, r, 1) Then GoTo nextC
            acc = Replace(Txt(a, r, 4), " ", "")
            scope = Txt(a, r, 6)
            line = LineForFrag(acc)
            If Len(scope) < 12 Then
                If Len(line) > 0 Then scope = NameOfLine(line)
                If Len(scope) = 0 Then scope = "Contract"
            End If
            po = Txt(a, r, 3)
            If Len(po) = 0 Then po = "TBC-" & acc
            nC = nC + 1
            outC(nC, ColIndex(loC, "SR No")) = NumOf(a, r, 1)
            outC(nC, ColIndex(loC, "Title")) = Left$(IIf(Len(scope) > 0, scope, CanonicalContractor(Txt(a, r, 5))), 120)
            outC(nC, ColIndex(loC, "PR No")) = Txt(a, r, 2)
            outC(nC, ColIndex(loC, "PO No")) = po
            outC(nC, ColIndex(loC, "ACC ref")) = acc
            outC(nC, ColIndex(loC, "Contractor")) = CanonicalContractor(Txt(a, r, 5))
            outC(nC, ColIndex(loC, "Package")) = PackageOfLine(line)
            outC(nC, ColIndex(loC, "Cost line")) = line
            outC(nC, ColIndex(loC, "Scope")) = scope
            outC(nC, ColIndex(loC, "Status")) = IIf(UCase$(Txt(a, r, 7)) = "CLOSED", "Closed", "Active")
            outC(nC, ColIndex(loC, "Original completion")) = DateOf(a, r, 8)
            outC(nC, ColIndex(loC, "EOT days")) = IIf(IsNum(a, r, 9), NumOf(a, r, 9), 0)
            outC(nC, ColIndex(loC, "Original contract")) = MoneyOr0(a, r, 12)
            outC(nC, ColIndex(loC, "FA adjustment")) = MoneyOr0(a, r, 15)
            outC(nC, ColIndex(loC, "VAT %")) = 15
            outC(nC, ColIndex(loC, "IPC days")) = 28
            outC(nC, ColIndex(loC, "Payment days")) = 30
            If Not IsEmpty(MoneyOf(a, r, 18)) Then outC(nC, ColIndex(loC, "Notes")) = "Excel Schedule H: applied " & Format$(MoneyOr0(a, r, 18), "#,##0") & ", certified " & Format$(MoneyOr0(a, r, 19), "#,##0") & ", paid " & Format$(MoneyOr0(a, r, 20), "#,##0")
            If Not contractByFrag.Exists(acc) Then contractByFrag.Add acc, nC
nextC:
        Next r
    End If
    ' contracts that only appear in Schedule B (awarded lines with a contractor but no Schedule H row)
    Dim lo2 As ListObject, i As Long, frag As String, nextSr As Long
    Set lo2 = TableOf("tblLevel2")
    nextSr = 0
    For i = 1 To nC
        If CDbl(Nz(outC(i, ColIndex(loC, "SR No")), 0)) > nextSr Then nextSr = CLng(outC(i, ColIndex(loC, "SR No")))
    Next i
    For i = 1 To RowCountOf(lo2)
        If CellText(lo2, i, "Budget hold") = "Yes" Or CellText(lo2, i, "Section") <> "Committed" Or Len(CellText(lo2, i, "Contractor")) = 0 Then GoTo nextL
        frag = FragOf(CellText(lo2, i, "Code"))
        If Len(frag) = 0 Then GoTo nextL
        If contractByFrag.Exists(frag) Then GoTo nextL
        If LineForFrag(frag) <> CellText(lo2, i, "Code") Then GoTo nextL
        If InStr(CellText(lo2, i, "Contractor"), "Al Rajhi") > 0 Then GoTo nextL
        nextSr = nextSr + 1
        nC = nC + 1
        outC(nC, ColIndex(loC, "SR No")) = nextSr
        outC(nC, ColIndex(loC, "Title")) = Left$(CellText(lo2, i, "Name"), 120)
        outC(nC, ColIndex(loC, "PO No")) = "TBC-" & frag
        outC(nC, ColIndex(loC, "ACC ref")) = frag
        outC(nC, ColIndex(loC, "Contractor")) = CellText(lo2, i, "Contractor")
        outC(nC, ColIndex(loC, "Package")) = CellText(lo2, i, "Package")
        outC(nC, ColIndex(loC, "Cost line")) = CellText(lo2, i, "Code")
        outC(nC, ColIndex(loC, "Scope")) = CellText(lo2, i, "Name")
        outC(nC, ColIndex(loC, "Status")) = "Active"
        outC(nC, ColIndex(loC, "EOT days")) = 0
        outC(nC, ColIndex(loC, "Original contract")) = CDbl(Nz(lo2.DataBodyRange.Cells(i, ColIndex(lo2, "E")).Value, 0)) + CDbl(Nz(lo2.DataBodyRange.Cells(i, ColIndex(lo2, "Opening transfers")).Value, 0))
        outC(nC, ColIndex(loC, "FA adjustment")) = 0
        outC(nC, ColIndex(loC, "VAT %")) = 15
        outC(nC, ColIndex(loC, "IPC days")) = 28
        outC(nC, ColIndex(loC, "Payment days")) = 30
        contractByFrag.Add frag, nC
nextL:
    Next i
    ' contract parameters from the IPC sheets (advance, retention, VAT, days)
    Dim ci As Long, prm As Variant, key As Variant
    For Each key In fragBy.Keys
        If contractByFrag.Exists(fragBy(key)) Then
            ci = contractByFrag(fragBy(key))
            prm = paramsBy(key)
            outC(ci, ColIndex(loC, "Advance %")) = prm(2)
            outC(ci, ColIndex(loC, "Retention %")) = prm(3)
            outC(ci, ColIndex(loC, "VAT %")) = prm(4)
            outC(ci, ColIndex(loC, "IPC days")) = prm(5)
            outC(ci, ColIndex(loC, "Payment days")) = prm(6)
        End If
    Next key
    FillTable loC, outC, nC
    ' IPC rows
    Dim outI() As Variant, nI As Long, ci2 As Long, colIpcNo As Long, colIpcRef As Long, colIpcDate As Long, colCum As Long, colGross As Long, colInv As Long, colInvDate As Long, colPaid As Long
    Dim prevCum As Double, cnt As Long, cum As Variant, gross As Variant, appNo As String, seenApp As Object, dup As Long, appDate As Variant, skipped As String
    ReDim outI(1 To 3000, 1 To loI.ListColumns.Count)
    For Each s In ipcSheets
        Set ws = s
        ci2 = ContractForSheet(ws, fragBy, engFragBy, contractByFrag, outC, loC)
        If ci2 = 0 Then
            skipped = skipped & vbCrLf & "  IPC sheet '" & ws.Name & "' skipped - contract not identified."
            GoTo nextSheet
        End If
        prm = paramsBy(ws.Name)
        layoutA = prm(0)
        ih = prm(1)
        ia = Grid(ws)
        If layoutA Then
            colIpcNo = 12: colIpcRef = 13: colIpcDate = 14: colCum = 17: colGross = 18: colInv = 23: colInvDate = 24: colPaid = 25
        Else
            colIpcNo = 9: colIpcRef = 10: colIpcDate = 11: colCum = 14: colGross = 15: colInv = 20: colInvDate = 21: colPaid = 22
        End If
        prevCum = 0
        cnt = 0
        Set seenApp = New Dict
        For r = ih + 3 To UBound(ia, 1)
            If StartsWith(UCase$(Txt(ia, r, 1)), "TOTAL") Then Exit For
            If Not IsNum(ia, r, 1) Or Not IsNum(ia, r, 6) Then GoTo nextI
            cnt = cnt + 1
            cum = MoneyOf(ia, r, colCum)
            gross = MoneyOf(ia, r, colGross)
            If Not IsEmpty(cum) And Not IsEmpty(gross) And cnt > 1 Then
                If Abs(CDbl(cum) - CDbl(gross)) < 0.5 And prevCum > 0 And CDbl(cum) < prevCum Then cum = Round(prevCum + CDbl(gross), 2)
            End If
            If Not IsEmpty(cum) Then prevCum = CDbl(cum)
            appNo = Txt(ia, r, 2)
            If Len(appNo) = 0 Then appNo = "IPA " & CStr(NumOf(ia, r, 1))
            If seenApp.Exists(LCase$(appNo)) Then
                dup = seenApp(LCase$(appNo)) + 1
                seenApp(LCase$(appNo)) = dup
                appNo = appNo & " (" & dup & ")"
            Else
                seenApp.Add LCase$(appNo), 1
            End If
            appDate = DateOf(ia, r, 5)
            If IsEmpty(appDate) Then appDate = DateOf(ia, r, colIpcDate)
            If IsEmpty(appDate) Then appDate = DateOf(ia, r, 3)
            If IsEmpty(appDate) Then appDate = periodEnd
            nI = nI + 1
            outI(nI, ColIndex(loI, "Contract")) = outC(ci2, ColIndex(loC, "PO No"))
            outI(nI, ColIndex(loI, "SR")) = NumOf(ia, r, 1)
            outI(nI, ColIndex(loI, "Application No")) = appNo
            outI(nI, ColIndex(loI, "Month")) = MonthText(ia, r, 3)
            outI(nI, ColIndex(loI, "Application ref")) = Txt(ia, r, 4)
            outI(nI, ColIndex(loI, "Application date")) = appDate
            outI(nI, ColIndex(loI, "Cum. claimed")) = MoneyOf(ia, r, 6)
            outI(nI, ColIndex(loI, "IPC No")) = Txt(ia, r, colIpcNo)
            outI(nI, ColIndex(loI, "IPC ref")) = Txt(ia, r, colIpcRef)
            outI(nI, ColIndex(loI, "IPC date")) = DateOf(ia, r, colIpcDate)
            outI(nI, ColIndex(loI, "Cum. certified")) = cum
            outI(nI, ColIndex(loI, "Invoice ref")) = Txt(ia, r, colInv)
            outI(nI, ColIndex(loI, "Invoice date")) = DateOf(ia, r, colInvDate)
            outI(nI, ColIndex(loI, "Paid date")) = DateOf(ia, r, colPaid)
nextI:
        Next r
nextSheet:
    Next s
    FillTable loI, outI, nI
    ImportContractsAndIpcs = "Contracts: " & nC & " - payment applications: " & nI & skipped
End Function

Private Function NameOfLine(ByVal code As String) As String
    Dim lo As ListObject, r As Long
    Set lo = TableOf("tblLevel2")
    r = FindRow(lo, "Code", code)
    If r > 0 Then NameOfLine = CellText(lo, r, "Name")
End Function

Private Function DaysFromRule(ByVal rule As String, ByVal dflt As Long) As Long
    Dim p As Long, i As Long, s As String
    p = InStr(rule, "+")
    If p = 0 Then
        DaysFromRule = dflt
        Exit Function
    End If
    s = Trim$(Mid$(rule, p + 1))
    For i = 1 To Len(s)
        If Not Mid$(s, i, 1) Like "#" Then Exit For
    Next i
    If i > 1 Then DaysFromRule = CLng(Left$(s, i - 1)) Else DaysFromRule = dflt
End Function

' The ACC code fragment (e.g. 031C10) found in the reference columns of an IPC sheet.
Private Function FindFragIn(ByRef a As Variant, ByVal hdr As Long, ByVal cols As Variant) As String
    Dim r As Long, i As Long, s As String, p As Long
    For r = hdr + 3 To UBound(a, 1)
        For i = LBound(cols) To UBound(cols)
            s = UCase$(Txt(a, r, CLng(cols(i))))
            For p = 2 To Len(s) - 6
                If Mid$(s, p - 1, 1) = "-" And Mid$(s, p, 6) Like "###[A-Z]##" And Mid$(s, p + 6, 1) = "-" Then
                    FindFragIn = Mid$(s, p, 6)
                    Exit Function
                End If
            Next p
        Next i
    Next r
End Function

' Which contract an IPC sheet belongs to: PO number in the title, the ACC fragment in its refs, else the contractor.
Private Function ContractForSheet(ByVal ws As Worksheet, ByVal fragBy As Object, ByVal engFragBy As Object, ByVal byFrag As Object, ByRef outC As Variant, ByVal loC As ListObject) As Long
    Dim title As String, i As Long, po As String, canon As String, mine As Long, first As Long, p As Long
    title = Trim$(ws.Name)
    If LCase$(Left$(title, 10)) = "schedule h" Then title = Trim$(Mid$(title, 11))
    If Left$(title, 1) = "-" Then title = Trim$(Mid$(title, 2))
    ' a 7-digit PO / PR number in the title
    For p = 1 To Len(title) - 6
        If Mid$(title, p, 7) Like "#######" Then
            po = Mid$(title, p, 7)
            Exit For
        End If
    Next p
    If Len(po) > 0 Then
        For i = 1 To UBound(outC, 1)
            If CStr(Nz(outC(i, ColIndex(loC, "PO No")))) = po Or CStr(Nz(outC(i, ColIndex(loC, "PR No")))) = po Then
                ContractForSheet = i
                Exit Function
            End If
        Next i
    End If
    If byFrag.Exists(fragBy(ws.Name)) Then
        ContractForSheet = byFrag(fragBy(ws.Name))
        Exit Function
    End If
    canon = CanonicalContractor(IIf(LCase$(title) Like "*als*", "Al Saad " & title, title))
    mine = 0
    first = 0
    For i = 1 To UBound(outC, 1)
        If Len(CStr(Nz(outC(i, 1)))) = 0 And IsEmpty(outC(i, ColIndex(loC, "PO No"))) Then Exit For
        If CStr(Nz(outC(i, ColIndex(loC, "Contractor")))) = canon Then
            mine = mine + 1
            If first = 0 Then first = i
            ' prefer the early-works contract for "EW" sheets and the other one otherwise
            If (InStr(1, title, "EW", vbBinaryCompare) > 0 Or InStr(1, LCase$(title), "early") > 0) = (InStr(1, LCase$(CStr(Nz(outC(i, ColIndex(loC, "Scope"))))), "early") > 0) Then first = i
        End If
    Next i
    If mine >= 1 Then
        ContractForSheet = first
        Exit Function
    End If
    If byFrag.Exists(engFragBy(ws.Name)) Then ContractForSheet = byFrag(engFragBy(ws.Name))
End Function

Private Function MonthText(ByRef a As Variant, ByVal r As Long, ByVal c As Long) As String
    Dim d As Variant
    d = DateOf(a, r, c)
    If IsEmpty(d) Then MonthText = Txt(a, r, c) Else MonthText = Format$(CDate(d), "mmm'yy")
End Function

' Schedule C -> tblChanges
Private Function ImportChanges(ByVal wb As Workbook, ByVal asset As String) As String
    Dim ws As Worksheet, a As Variant, hdr As Long, r As Long, lo As ListObject, out() As Variant, n As Long, seen As Object
    Dim item As String, dup As Long, itemNo As String, dvoSt As String, rfcSt As String, pvoSt As String, voSt As String, excelSt As String, u As String, overall As String
    Dim pvoAmt As Variant, rfcAmt As Variant, dvoAmt As Variant, closed As Variant, pendingBy As String, pending As String, rep As String, stage As String, note As String, pk As String
    Set ws = SheetNamed(wb, "Schedule C")
    Set lo = TableOf("tblChanges")
    If ws Is Nothing Then
        ImportChanges = "Schedule C not found - changes unchanged."
        Exit Function
    End If
    Set seen = New Dict
    a = Grid(ws)
    hdr = HeaderRowWith(a, 16, "item", "description of change")
    ReDim out(1 To UBound(a, 1) + 1, 1 To lo.ListColumns.Count)
    For r = hdr + 3 To UBound(a, 1)
        If Not IsNum(a, r, 1) Then GoTo nextRow
        item = CStr(Fix(NumOf(a, r, 1)))
        If seen.Exists(item) Then
            dup = seen(item) + 1
            seen(item) = dup
            itemNo = "CH-" & Pad(CLng(item), 3) & Chr$(96 + dup)
        Else
            seen.Add item, 1
            itemNo = "CH-" & Pad(CLng(item), 3)
        End If
        dvoSt = StageStatus(Txt(a, r, 54))
        rfcSt = StageStatus(Txt(a, r, 21))
        pvoSt = StageStatus(Txt(a, r, 29))
        voSt = StageStatus(Txt(a, r, 37))
        excelSt = Txt(a, r, 7)
        u = UCase$(excelSt)
        If InStr(u, "ACCEPT") > 0 Or InStr(u, "APPROV") > 0 Then
            overall = "Approved"
        ElseIf InStr(u, "REJECT") > 0 Or InStr(u, "SUPERSED") > 0 Or InStr(u, "CANCEL") > 0 Then
            overall = "Rejected"
        ElseIf InStr(u, "FINAL ACCOUNT") > 0 Then
            overall = IIf(dvoSt = "Approved" Or dvoSt = "Review Complete", "Approved", "Pending")
        Else
            overall = "Pending"
        End If
        pvoAmt = MoneyOf(a, r, 34)
        rfcAmt = MoneyOf(a, r, 25)
        dvoAmt = MoneyOf(a, r, 53)
        closed = Empty
        If overall = "Approved" And (dvoSt = "Approved" Or dvoSt = "Review Complete") Then
            closed = DateOf(a, r, 51)
            If IsEmpty(closed) Then closed = LatestDate(a, r, Array(51, 48, 45, 40, 36, 28, 20))
        ElseIf overall = "Rejected" Then
            closed = LatestDate(a, r, Array(51, 48, 45, 40, 36, 28, 20))
        End If
        pendingBy = Txt(a, r, 6)
        Select Case UCase$(pendingBy)
            Case "CLOSED", "N/A": pending = "None"
            Case Else: pending = "Commercial Team"
        End Select
        rep = Txt(a, r, 5)
        If UCase$(rep) = "CLOSED" Or UCase$(rep) = "OTHER" Or UCase$(rep) = "N/A" Then rep = "" Else rep = StrConv(rep, vbProperCase)
        stage = Replace(Replace(Txt(a, r, 3), "Post Contract", "Post-Contract"), "Pre Contract", "Pre-Contract")
        note = ""
        If Len(excelSt) > 0 Then note = "Excel status: " & excelSt
        If Len(Txt(a, r, 62)) > 0 Then note = note & IIf(Len(note) > 0, " | ", "") & "Comments: " & Txt(a, r, 62)
        If Len(pendingBy) > 0 Then note = note & IIf(Len(note) > 0, " | ", "") & "Action pending by (Excel): " & pendingBy
        pk = CanonicalPackage(Txt(a, r, 13))
        n = n + 1
        out(n, ColIndex(lo, "Item No")) = itemNo
        out(n, ColIndex(lo, "Description")) = Txt(a, r, 2)
        out(n, ColIndex(lo, "Overall status")) = overall
        out(n, ColIndex(lo, "Date raised")) = FirstDate(a, r, Array(20, 16, 28))
        out(n, ColIndex(lo, "Package")) = pk
        out(n, ColIndex(lo, "Contractor")) = CanonicalContractor(Txt(a, r, 14))
        out(n, ColIndex(lo, "Cost line")) = LineForPackage(Txt(a, r, 13))
        out(n, ColIndex(lo, "Project stage")) = stage
        out(n, ColIndex(lo, "Category")) = Txt(a, r, 4)
        out(n, ColIndex(lo, "Initiated by")) = Txt(a, r, 8)
        out(n, ColIndex(lo, "Amaala rep")) = rep
        out(n, ColIndex(lo, "Action pending by")) = pending
        out(n, ColIndex(lo, "Closed date")) = closed
        out(n, ColIndex(lo, "EW ref")) = Txt(a, r, 15)
        out(n, ColIndex(lo, "EW date")) = DateOf(a, r, 16)
        out(n, ColIndex(lo, "RFC ref")) = Txt(a, r, 18)
        out(n, ColIndex(lo, "RFC date")) = DateOf(a, r, 20)
        out(n, ColIndex(lo, "RFC status")) = rfcSt
        out(n, ColIndex(lo, "RFC time impact")) = TimeImpact(a, r, 23)
        out(n, ColIndex(lo, "RFC tracker amount")) = rfcAmt
        If Not IsEmpty(rfcAmt) Then out(n, ColIndex(lo, "RFC amount")) = 0
        out(n, ColIndex(lo, "PVO ref")) = Txt(a, r, 26)
        out(n, ColIndex(lo, "PVO date")) = DateOf(a, r, 28)
        out(n, ColIndex(lo, "PVO status")) = pvoSt
        out(n, ColIndex(lo, "PVO time impact")) = TimeImpact(a, r, 32)
        out(n, ColIndex(lo, "PVO tracker amount")) = pvoAmt
        out(n, ColIndex(lo, "PVO amount")) = pvoAmt
        out(n, ColIndex(lo, "VO ref")) = Txt(a, r, 35)
        out(n, ColIndex(lo, "VO date")) = DateOf(a, r, 36)
        out(n, ColIndex(lo, "VO status")) = voSt
        If Len(Txt(a, r, 35)) > 0 Then out(n, ColIndex(lo, "VO amount")) = pvoAmt
        out(n, ColIndex(lo, "EI ref")) = Txt(a, r, 39)
        out(n, ColIndex(lo, "EI date")) = DateOf(a, r, 40)
        out(n, ColIndex(lo, "DVO ref")) = Txt(a, r, 42)
        out(n, ColIndex(lo, "DVO date")) = DateOf(a, r, 51)
        out(n, ColIndex(lo, "DVO status")) = dvoSt
        out(n, ColIndex(lo, "DVO tracker amount")) = MoneyOf(a, r, 46)
        out(n, ColIndex(lo, "DVO amount")) = dvoAmt
        out(n, ColIndex(lo, "DVO closed")) = YesNo(overall = "Approved" And (dvoSt = "Approved" Or dvoSt = "Review Complete"))
        out(n, ColIndex(lo, "Notes")) = note
nextRow:
    Next r
    FillTable lo, out, n
    ImportChanges = "Changes: " & n
End Function

Private Function LatestDate(ByRef a As Variant, ByVal r As Long, ByVal cols As Variant) As Variant
    Dim i As Long, d As Variant, best As Variant
    best = Empty
    For i = LBound(cols) To UBound(cols)
        d = DateOf(a, r, CLng(cols(i)))
        If Not IsEmpty(d) Then
            If IsEmpty(best) Then
                best = d
            ElseIf CDate(d) > CDate(best) Then
                best = d
            End If
        End If
    Next i
    LatestDate = best
End Function

Private Function FirstDate(ByRef a As Variant, ByVal r As Long, ByVal cols As Variant) As Variant
    Dim i As Long, d As Variant
    For i = LBound(cols) To UBound(cols)
        d = DateOf(a, r, CLng(cols(i)))
        If Not IsEmpty(d) Then
            FirstDate = d
            Exit Function
        End If
    Next i
    FirstDate = Empty
End Function

' Early Warning sheet -> tblEW
Private Function ImportEarlyWarnings(ByVal wb As Workbook, ByVal periodEnd As Date) As String
    Dim ws As Worksheet, a As Variant, r As Long, lo As ListObject, out() As Variant, n As Long, seen As Object, desc As String, p As String, base As String, dup As Long, cost As Double, note As String
    Set ws = SheetNamed(wb, "Early Warning", "Early Warnings")
    Set lo = TableOf("tblEW")
    If ws Is Nothing Then
        ImportEarlyWarnings = "Early Warning sheet not found - early warnings unchanged."
        Exit Function
    End If
    Set seen = New Dict
    a = Grid(ws)
    ReDim out(1 To UBound(a, 1) + 1, 1 To lo.ListColumns.Count)
    For r = 1 To UBound(a, 1)
        desc = Txt(a, r, 3)
        p = Txt(a, r, 2)
        If Len(desc) = 0 Or Len(p) = 0 Then GoTo nextRow
        If StartsWith(UCase$(Txt(a, r, 1)), "SUB") Then GoTo nextRow
        If UCase$(p) = p Then GoTo nextRow ' section titles are upper case
        base = IIf(Len(Txt(a, r, 1)) > 0, "EW-" & Txt(a, r, 1), "EW")
        If seen.Exists(base) Then
            dup = seen(base) + 1
            seen(base) = dup
        Else
            seen.Add base, 1
            dup = 1
        End If
        cost = MoneyOr0(a, r, 4)
        note = ""
        If Len(Txt(a, r, 5)) > 0 Then note = "Excel stage: " & Txt(a, r, 5)
        If Len(Txt(a, r, 6)) > 0 Then note = note & IIf(Len(note) > 0, " | ", "") & Txt(a, r, 6)
        n = n + 1
        out(n, ColIndex(lo, "EW No")) = base & IIf(dup = 1, "", "-" & dup)
        out(n, ColIndex(lo, "Date raised")) = periodEnd
        out(n, ColIndex(lo, "Raised by")) = "Contractor"
        out(n, ColIndex(lo, "Package")) = CanonicalPackage(p)
        out(n, ColIndex(lo, "Contractor")) = CanonicalContractor(p)
        out(n, ColIndex(lo, "Description")) = desc
        out(n, ColIndex(lo, "Cost impact")) = cost
        out(n, ColIndex(lo, "Likelihood")) = IIf(cost <> 0, "High", "Med")
        out(n, ColIndex(lo, "Status")) = "Open"
        out(n, ColIndex(lo, "Cost line")) = LineForPackage(p)
        out(n, ColIndex(lo, "Notes")) = note
nextRow:
    Next r
    FillTable lo, out, n
    ImportEarlyWarnings = "Early warnings: " & n
End Function

' Schedule D -> tblRisks
Private Function ImportRisks(ByVal wb As Workbook, ByVal periodEnd As Date) As String
    Dim ws As Worksheet, a As Variant, r As Long, lo As ListObject, out() As Variant, n As Long, no As Double, risk As Variant, opp As Variant
    Set ws = SheetNamed(wb, "Schedule D")
    Set lo = TableOf("tblRisks")
    If ws Is Nothing Then
        ImportRisks = "Schedule D not found - risks unchanged."
        Exit Function
    End If
    a = Grid(ws)
    ReDim out(1 To UBound(a, 1) + 1, 1 To lo.ListColumns.Count)
    For r = 1 To UBound(a, 1)
        If Not IsNum(a, r, 1) Then GoTo nextRow
        no = NumOf(a, r, 1)
        If no = Fix(no) Then GoTo nextRow
        If Len(Txt(a, r, 2)) = 0 Then GoTo nextRow
        risk = MoneyOf(a, r, 3)
        opp = MoneyOf(a, r, 4)
        n = n + 1
        out(n, ColIndex(lo, "No")) = "RO-" & Format$(no, "0.00")
        out(n, ColIndex(lo, "Type")) = IIf(Not IsEmpty(opp) And CDbl(Nz(opp, 0)) <> 0, "Opportunity", "Risk")
        out(n, ColIndex(lo, "Description")) = Txt(a, r, 2)
        out(n, ColIndex(lo, "Cost impact")) = IIf(IsEmpty(risk), -CDbl(Nz(opp, 0)), CDbl(risk))
        out(n, ColIndex(lo, "Status")) = "Open"
        out(n, ColIndex(lo, "Date")) = periodEnd
        out(n, ColIndex(lo, "Notes")) = "From Schedule D; date set to the period end"
nextRow:
    Next r
    FillTable lo, out, n
    ImportRisks = "Risks & opportunities: " & n
End Function

' Schedule F -> tblPS
Private Function ImportProvisionalSums(ByVal wb As Workbook) As String
    Dim ws As Worksheet, a As Variant, hdr As Long, r As Long, lo As ListObject, out() As Variant, n As Long, st As String
    Set ws = SheetNamed(wb, "Schedule F")
    Set lo = TableOf("tblPS")
    If ws Is Nothing Then
        ImportProvisionalSums = "Schedule F not found - provisional sums unchanged."
        Exit Function
    End If
    a = Grid(ws)
    hdr = HeaderRowWith(a, 11, "item", "description", "budget")
    ReDim out(1 To UBound(a, 1) + 1, 1 To lo.ListColumns.Count)
    For r = hdr + 1 To UBound(a, 1)
        If Not IsNum(a, r, 1) Or Len(Txt(a, r, 2)) = 0 Then GoTo nextRow
        st = Txt(a, r, 3)
        n = n + 1
        out(n, ColIndex(lo, "Item")) = "PS-" & Pad(CLng(Fix(NumOf(a, r, 1))), 2)
        out(n, ColIndex(lo, "Description")) = Txt(a, r, 2)
        out(n, ColIndex(lo, "Status")) = IIf(Len(st) > 0, UCase$(Left$(st, 1)) & LCase$(Mid$(st, 2)), "Pending")
        out(n, ColIndex(lo, "Contractor")) = CanonicalContractor(Txt(a, r, 4))
        out(n, ColIndex(lo, "Budget")) = MoneyOr0(a, r, 5)
        out(n, ColIndex(lo, "Contract value")) = MoneyOf(a, r, 6)
        out(n, ColIndex(lo, "Comments")) = Txt(a, r, 8)
nextRow:
    Next r
    FillTable lo, out, n
    ImportProvisionalSums = "Provisional sums: " & n
End Function

' Schedule J -> tblTransfers
Private Function ImportTransfers(ByVal wb As Workbook, ByVal periodEnd As Date) As String
    Dim ws As Worksheet, a As Variant, hdr As Long, r As Long, lo As ListObject, out() As Variant, n As Long, fromV As Variant, toV As Variant, amount As Double, seen As Object, base As String, dup As Long, dt As Variant
    Set ws = SheetNamed(wb, "Schedule J")
    Set lo = TableOf("tblTransfers")
    If ws Is Nothing Then
        ImportTransfers = "Schedule J not found - budget transfers unchanged."
        Exit Function
    End If
    Set seen = New Dict
    a = Grid(ws)
    hdr = HeaderRowWith(a, 11, "item", "from package")
    ReDim out(1 To UBound(a, 1) + 1, 1 To lo.ListColumns.Count)
    For r = hdr + 1 To UBound(a, 1)
        If Not IsNum(a, r, 1) Or Len(Txt(a, r, 2)) = 0 Then GoTo nextRow
        fromV = MoneyOf(a, r, 5)
        toV = MoneyOf(a, r, 6)
        If Not IsEmpty(toV) And CDbl(Nz(toV, 0)) <> 0 Then amount = Abs(CDbl(toV)) Else amount = Abs(CDbl(Nz(fromV, 0)))
        If amount = 0 Then GoTo nextRow
        base = "BT-" & Pad(CLng(Fix(NumOf(a, r, 1))), 2)
        If seen.Exists(base) Then
            dup = seen(base) + 1
            seen(base) = dup
            base = base & Chr$(96 + dup)
        Else
            seen.Add base, 1
        End If
        dt = DateOf(a, r, 7)
        n = n + 1
        out(n, ColIndex(lo, "Item")) = base
        out(n, ColIndex(lo, "Description")) = Txt(a, r, 2)
        out(n, ColIndex(lo, "Status")) = "Approved"
        out(n, ColIndex(lo, "From package")) = IIf(Len(Txt(a, r, 3)) > 0, CanonicalPackage(Txt(a, r, 3)), "Budget Hold")
        out(n, ColIndex(lo, "To package")) = IIf(Len(Txt(a, r, 4)) > 0, CanonicalPackage(Txt(a, r, 4)), "Budget Hold")
        out(n, ColIndex(lo, "Amount")) = Round(amount, 2)
        out(n, ColIndex(lo, "Date")) = IIf(IsEmpty(dt), periodEnd, dt)
        out(n, ColIndex(lo, "Approval ref")) = Txt(a, r, 8)
        out(n, ColIndex(lo, "Notes")) = "Schedule B already carries these transfers in column F; the register is for reference."
nextRow:
    Next r
    FillTable lo, out, n
    ImportTransfers = "Budget transfers: " & n
End Function

' ---- the AMAALA Claims Tracker ----------------------------------------------------------------

Public Sub ImportClaimsTracker()
    If Not RequireEditor() Then Exit Sub
    Dim path As String, wb As Workbook, ws As Worksheet, a As Variant, hdr As Long, r As Long, lo As ListObject, out() As Variant, n As Long, total As Long
    Dim prog As String, asset As String, contractNo As String, assetCode As String, mine As Boolean, no As Long, kind As String, isCost As Boolean, frag As String, line As String
    Dim st67 As String, st68 As String, rejected As Boolean, approved As Boolean, status As String, claimNo As String, notes As String, asOf As Variant, c As Long, joined As String
    path = PickFile("Choose the AMAALA Claims Tracker workbook", "Excel workbooks", "*.xlsx;*.xlsm;*.xls")
    If Len(path) = 0 Then Exit Sub
    prog = NormCode(CStr(Nz(NamedValue("ProgrammeCode"))))
    asset = NormCode(CStr(Nz(NamedValue("AssetCode"))))
    modUndo.Checkpoint "Import claims tracker"
    Busy True, "Reading the Claims Tracker..."
    On Error GoTo fail
    Set wb = Workbooks.Open(path, ReadOnly:=True, UpdateLinks:=0)
    Set lo = TableOf("tblClaims")
    ReDim out(1 To 2000, 1 To lo.ListColumns.Count)
    For Each ws In wb.Worksheets
        a = Grid(ws)
        hdr = 0
        For r = 1 To UBound(a, 1)
            joined = ""
            For c = 1 To UBound(a, 2)
                joined = joined & " | " & LCase$(Txt(a, r, c))
            Next c
            If InStr(joined, "claim no") > 0 And InStr(joined, "assessment type") > 0 And InStr(joined, "contract no") > 0 Then
                hdr = r
                Exit For
            End If
        Next r
        If hdr = 0 Then GoTo nextWs
        For r = 1 To hdr + 2
            If InStr(LCase$(Txt(a, r, 1)), "as of") > 0 Then asOf = DateOf(a, r, 4)
        Next r
        For r = hdr + 3 To UBound(a, 1)
            If Not IsNum(a, r, 1) Or Len(Txt(a, r, 3)) = 0 Then GoTo nextRow
            total = total + 1
            contractNo = Txt(a, r, 4)
            assetCode = NormCode(Txt(a, r, 5))
            mine = False
            If Len(contractNo) > 0 And Len(prog) > 0 Then
                If StartsWith(NormCode(contractNo), prog) Then mine = True
            End If
            If Len(assetCode) > 0 And assetCode = asset Then mine = True
            If Not mine Then GoTo nextRow
            no = CLng(Fix(NumOf(a, r, 1)))
            kind = UCase$(Txt(a, r, 2))
            isCost = InStr(kind, "COST") > 0
            frag = ""
            If Len(contractNo) > 0 Then frag = ContractFrag(contractNo, prog)
            line = IIf(Len(frag) > 0, LineForFrag(frag), "")
            claimNo = "CT-" & Pad(no, 3)
            st67 = LCase$(Txt(a, r, 67))
            st68 = LCase$(Txt(a, r, 68))
            rejected = StartsWith(st67, "cancel") Or StartsWith(st68, "cancel") Or StartsWith(LCase$(Txt(a, r, 72)), "merit") Or LCase$(Txt(a, r, 54)) = "rejected" Or LCase$(Txt(a, r, 44)) = "rejected"
            approved = InStr(st68, "determination issued") > 0 Or InStr(st68, "dvo issued") > 0 Or InStr(st68, "ei issued") > 0
            status = IIf(rejected, "Rejected", IIf(approved, "Approved", "Pending"))
            notes = "Claims Tracker item " & no & " (" & IIf(Len(Txt(a, r, 2)) > 0, Txt(a, r, 2), "claim") & ")"
            If Len(Txt(a, r, 67)) > 0 Then notes = notes & " - Assessment report: " & Txt(a, r, 67)
            If Len(Txt(a, r, 68)) > 0 Then notes = notes & " - EI / DVO: " & Txt(a, r, 68)
            If Len(Txt(a, r, 69)) > 0 Then notes = notes & " - Action with: " & Txt(a, r, 69)
            If LCase$(Txt(a, r, 73)) = "yes" Then notes = notes & " - Notice of Dissatisfaction: Yes"
            If LCase$(Txt(a, r, 74)) = "yes" Then notes = notes & " - Notice of Dispute: Yes"
            If Len(Txt(a, r, 70)) > 0 Then notes = notes & " - Remarks: " & Txt(a, r, 70)
            n = n + 1
            out(n, ColIndex(lo, "Claim No")) = claimNo
            out(n, ColIndex(lo, "Description")) = Txt(a, r, 3) & IIf(isCost, " [Cost claim]", IIf(InStr(kind, "TIA") > 0, " [Time claim]", ""))
            out(n, ColIndex(lo, "Status")) = status
            out(n, ColIndex(lo, "Contractor")) = IIf(Len(line) > 0, ContractorOfLine(line), CanonicalContractor(Txt(a, r, 8)))
            out(n, ColIndex(lo, "Contract No")) = contractNo
            out(n, ColIndex(lo, "Project")) = Txt(a, r, 6)
            out(n, ColIndex(lo, "Scope")) = Txt(a, r, 7)
            out(n, ColIndex(lo, "Package")) = PackageOfLine(line)
            out(n, ColIndex(lo, "Cost line")) = line
            out(n, ColIndex(lo, "In cost report")) = YesNo(status = "Approved")
            out(n, ColIndex(lo, "EOT")) = YesNo(YesOf(a, r, 9))
            out(n, ColIndex(lo, "Prolongation")) = YesNo(YesOf(a, r, 10))
            out(n, ColIndex(lo, "Disruption")) = YesNo(YesOf(a, r, 11))
            out(n, ColIndex(lo, "Acceleration")) = YesNo(YesOf(a, r, 12))
            out(n, ColIndex(lo, "Other")) = YesNo(YesOf(a, r, 13) Or YesOf(a, r, 14))
            out(n, ColIndex(lo, "Other - describe")) = IIf(YesOf(a, r, 13), "Notice of Dissatisfaction", IIf(YesOf(a, r, 14), "Other", ""))
            out(n, ColIndex(lo, "(A) Aware date")) = DateOf(a, r, 15)
            out(n, ColIndex(lo, "Notice letter ref")) = Txt(a, r, 16)
            out(n, ColIndex(lo, "(B) Received date")) = DateOf(a, r, 17)
            out(n, ColIndex(lo, "Response ref")) = Txt(a, r, 20)
            out(n, ColIndex(lo, "Response date")) = DateOf(a, r, 21)
            out(n, ColIndex(lo, "Detailed claim ref")) = Txt(a, r, 22)
            out(n, ColIndex(lo, "(C) Detail received date")) = DateOf(a, r, 23)
            out(n, ColIndex(lo, "Detailed response ref")) = Txt(a, r, 26)
            out(n, ColIndex(lo, "Detailed response date")) = DateOf(a, r, 27)
            out(n, ColIndex(lo, "Resubmission ref")) = Txt(a, r, 30)
            out(n, ColIndex(lo, "Resubmission date")) = DateOf(a, r, 31)
            out(n, ColIndex(lo, "Contractor EOT days")) = MoneyOf(a, r, 32)
            out(n, ColIndex(lo, "Contractor comp. days")) = MoneyOf(a, r, 33)
            out(n, ColIndex(lo, "Contractor cost")) = MoneyOf(a, r, 46)
            out(n, ColIndex(lo, "Contractor ref")) = IIf(Len(Txt(a, r, 22)) > 0, Txt(a, r, 22), Txt(a, r, 16))
            out(n, ColIndex(lo, "Contractor date")) = FirstDate(a, r, Array(23, 17))
            out(n, ColIndex(lo, "Engineer EOT days")) = MoneyOf(a, r, 34)
            out(n, ColIndex(lo, "Engineer comp. days")) = MoneyOf(a, r, 35)
            out(n, ColIndex(lo, "Engineer cost")) = MoneyOf(a, r, 47)
            out(n, ColIndex(lo, "Engineer ref")) = IIf(isCost, FirstText(a, r, Array(48, 36)), FirstText(a, r, Array(36, 48)))
            out(n, ColIndex(lo, "Engineer date")) = IIf(isCost, FirstDate(a, r, Array(49, 37)), FirstDate(a, r, Array(37, 49)))
            out(n, ColIndex(lo, "Employer EOT days")) = MoneyOf(a, r, 38)
            out(n, ColIndex(lo, "Employer comp. days")) = MoneyOf(a, r, 39)
            out(n, ColIndex(lo, "Employer cost")) = MoneyOf(a, r, 50)
            out(n, ColIndex(lo, "Employer ref")) = IIf(isCost, FirstText(a, r, Array(51, 40)), FirstText(a, r, Array(40, 51)))
            out(n, ColIndex(lo, "Employer date")) = IIf(isCost, FirstDate(a, r, Array(52, 41)), FirstDate(a, r, Array(41, 52)))
            out(n, ColIndex(lo, "Determination EOT days")) = MoneyOf(a, r, 42)
            out(n, ColIndex(lo, "Determination comp. days")) = MoneyOf(a, r, 43)
            out(n, ColIndex(lo, "Determination cost")) = MoneyOf(a, r, 53)
            out(n, ColIndex(lo, "Determination ref")) = IIf(isCost, FirstText(a, r, Array(54, 44)), FirstText(a, r, Array(44, 54)))
            out(n, ColIndex(lo, "Determination date")) = IIf(isCost, FirstDate(a, r, Array(55, 45)), FirstDate(a, r, Array(45, 55)))
            out(n, ColIndex(lo, "Notes")) = notes
nextRow:
        Next r
nextWs:
    Next ws
    wb.Close False
    If n = 0 Then
        Busy False
        MsgBox "No claims for programme " & CStr(Nz(NamedValue("ProgrammeCode"))) & " / asset " & CStr(Nz(NamedValue("AssetCode"))) & " were found (" & total & " claims in the file). Check the Programme and Asset codes on the Setup sheet.", vbExclamation, APP_TITLE
        Exit Sub
    End If
    FillTable lo, out, n
    ApplyAllFormulas
    Busy False
    Application.Calculate
    LogActivity "Claims Tracker imported", path & " - " & n & " of " & total & " claims"
    KeepImportedFile path, "Claims tracker"
    modUndo.AutoSave
    MsgBox n & " claims imported (of " & total & " in the tracker" & IIf(IsEmpty(asOf), "", ", as of " & Format$(CDate(asOf), "dd-mmm-yy")) & "). Pending claims are not carried in column M; approved claims feed it through their determined amount.", vbInformation, APP_TITLE
    Exit Sub
fail:
    Busy False
    On Error Resume Next
    If Not wb Is Nothing Then wb.Close False
    MsgBox "The import stopped: " & Err.Description, vbExclamation, APP_TITLE
End Sub

Private Function FirstText(ByRef a As Variant, ByVal r As Long, ByVal cols As Variant) As String
    Dim i As Long, s As String
    For i = LBound(cols) To UBound(cols)
        s = Txt(a, r, CLng(cols(i)))
        If Len(s) > 0 And Not (LCase$(s) = "n/a" Or s = "-" Or LCase$(s) = "tbc" Or LCase$(s) = "nil") Then
            FirstText = s
            Exit Function
        End If
    Next i
End Function

Private Function NormCode(ByVal s As String) As String
    NormCode = UCase$(NormText(s))
End Function

' "1TB01031C02" -> "031C02"
Private Function ContractFrag(ByVal contractNo As String, ByVal prog As String) As String
    Dim c As String, tail As String
    c = NormCode(contractNo)
    If Len(prog) > 0 And StartsWith(c, prog) Then
        tail = Mid$(c, Len(prog) + 1)
    ElseIf c Like "1TB#####*" Then
        tail = Mid$(c, 9)
    Else
        tail = c
    End If
    ContractFrag = Right$(prog, 3) & tail
End Function

Private Function ContractorOfLine(ByVal code As String) As String
    Dim lo As ListObject, r As Long
    Set lo = TableOf("tblLevel2")
    r = FindRow(lo, "Code", code)
    If r > 0 Then ContractorOfLine = CellText(lo, r, "Contractor")
End Function
