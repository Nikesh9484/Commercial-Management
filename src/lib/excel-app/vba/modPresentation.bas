Option Explicit
' ------------------------------------------------------------------------------------------
' The cost report as a PowerPoint presentation (needs PowerPoint on this PC): the same slides
' as the website's deck - tiles, native charts copied from the Home sheet, editable tables -
' with a fade transition and staggered fade-in on every slide. Also saved as PDF.
' ------------------------------------------------------------------------------------------

Private Const SLIDE_W As Single = 960
Private Const SLIDE_H As Single = 540
Private Const PP_LAYOUT_BLANK As Long = 12
Private Const PP_EFFECT_FADE As Long = 1793
Private Const PP_SAVE_PDF As Long = 32

Private pptApp As Object
Private pres As Object
Private work As Worksheet
Private slideNo As Long
Private accents As Variant
Private accentIdx As Long

Private Function RGBHex(ByVal hex6 As String) As Long
    RGBHex = RGB(CLng("&H" & Mid$(hex6, 1, 2)), CLng("&H" & Mid$(hex6, 3, 2)), CLng("&H" & Mid$(hex6, 5, 2)))
End Function

Private Function Money(ByVal v As Variant) As String
    If IsNumeric(v) Then Money = Format$(Round(CDbl(v), 0), "#,##0;(#,##0)") Else Money = CStr(Nz(v))
End Function

Private Function L1(ByVal key As String) As Double
    On Error Resume Next
    L1 = CDbl(Nz(NamedValue("L1_" & key), 0))
End Function

' ---- slide helpers -------------------------------------------------------------------------

Private Function NewSlide(ByVal title As String, ByVal subtitle As String) As Object
    Dim sld As Object, accent As String, shp As Object
    slideNo = slideNo + 1
    Set sld = pres.Slides.Add(slideNo, PP_LAYOUT_BLANK)
    accent = accents(accentIdx Mod (UBound(accents) + 1))
    accentIdx = accentIdx + 1
    sld.SlideShowTransition.EntryEffect = PP_EFFECT_FADE
    Set shp = sld.Shapes.AddShape(1, 0, 0, 12, SLIDE_H)
    shp.Fill.ForeColor.RGB = RGBHex(accent)
    shp.Line.Visible = 0
    shp.Name = "band"
    AddText sld, title, 32, 16, 620, 40, 24, True, "1F3A5F", False
    If Len(subtitle) > 0 Then AddText sld, subtitle, 32, 52, 700, 22, 11, False, "6B7280", False
    AddText sld, CStr(Nz(NamedValue("ProgrammeCode"))) & "  -  " & CStr(Nz(NamedValue("CurrentPeriodLabel"))), 640, 18, 300, 22, 10, True, "1F3A5F", False
    Set shp = sld.Shapes.AddShape(1, 32, 78, SLIDE_W - 64, 1.5)
    shp.Fill.ForeColor.RGB = RGBHex("D6DCE5")
    shp.Line.Visible = 0
    Set shp = sld.Shapes.AddShape(1, 32, 76, 100, 5)
    shp.Fill.ForeColor.RGB = RGBHex(accent)
    shp.Line.Visible = 0
    AddText sld, APP_TITLE & "  -  Monthly Report No " & CStr(Nz(NamedValue("CurrentReportNo"))) & "  -  all amounts SAR", 32, SLIDE_H - 24, 600, 18, 8, False, "6B7280", False
    AddText sld, "Confidential - " & slideNo, 800, SLIDE_H - 24, 128, 18, 8, False, "6B7280", False
    Set NewSlide = sld
End Function

Private Function AddText(ByVal sld As Object, ByVal text As String, ByVal x As Single, ByVal y As Single, ByVal w As Single, ByVal h As Single, ByVal size As Single, ByVal bold As Boolean, ByVal color As String, ByVal animate As Boolean) As Object
    Dim shp As Object
    Set shp = sld.Shapes.AddTextbox(1, x, y, w, h)
    With shp.TextFrame
        .WordWrap = -1
        .MarginLeft = 2
        .MarginRight = 2
        .TextRange.Text = text
        .TextRange.Font.Name = "Calibri"
        .TextRange.Font.Size = size
        .TextRange.Font.Bold = bold
        .TextRange.Font.Color.RGB = RGBHex(color)
    End With
    If animate Then Animate shp
    Set AddText = shp
End Function

Private Sub Animate(ByVal shp As Object)
    On Error Resume Next
    With shp.AnimationSettings
        .EntryEffect = PP_EFFECT_FADE
        .Animate = -1
        .AdvanceMode = 2
        .AdvanceTime = 0.3
    End With
End Sub

Private Sub AddTile(ByVal sld As Object, ByVal i As Long, ByVal count As Long, ByVal label As String, ByVal value As String, ByVal subText As String, ByVal color As String)
    Dim gap As Single, w As Single, x As Single, shp As Object
    gap = 10
    w = (SLIDE_W - 64 - gap * (count - 1)) / count
    x = 32 + (i - 1) * (w + gap)
    Set shp = sld.Shapes.AddShape(5, x, 90, w, 78)
    shp.Fill.ForeColor.RGB = RGBHex(color)
    shp.Line.Visible = 0
    shp.Adjustments(1) = 0.08
    Animate shp
    AddText sld, UCase$(label), x + 6, 94, w - 12, 16, 7, True, "E4ECF6", True
    AddText sld, value, x + 6, 112, w - 12, 32, IIf(Len(value) > 14, 14, 18), True, "FFFFFF", True
    If Len(subText) > 0 Then AddText sld, subText, x + 6, 146, w - 12, 16, 7, False, "E4ECF6", True
End Sub

Private Sub AddSectionTitle(ByVal sld As Object, ByVal text As String, ByVal x As Single, ByVal y As Single, ByVal w As Single)
    Dim shp As Object
    Set shp = sld.Shapes.AddShape(1, x, y + 5, 8, 8)
    shp.Fill.ForeColor.RGB = RGBHex(accents((accentIdx - 1) Mod (UBound(accents) + 1)))
    shp.Line.Visible = 0
    Animate shp
    AddText sld, text, x + 12, y, w - 12, 20, 11, True, "1F3A5F", True
End Sub

' Copies one of the Home sheet charts onto the slide as an editable chart.
Private Sub AddHomeChart(ByVal sld As Object, ByVal index As Long, ByVal x As Single, ByVal y As Single, ByVal w As Single, ByVal h As Single)
    On Error GoTo skip
    Dim co As ChartObject, shp As Object
    Set co = ThisWorkbook.Worksheets("Home").ChartObjects(index)
    co.Chart.ChartArea.Copy
    DoEvents
    Set shp = sld.Shapes.Paste
    With shp
        .Left = x
        .Top = y
        .Width = w
        .Height = h
    End With
    Animate shp
    Application.CutCopyMode = False
    Exit Sub
skip:
    AddText sld, "(chart " & index & " could not be copied)", x, y, w, 20, 9, False, "6B7280", False
End Sub

' Writes a header + rows array to the work sheet, formats it and pastes it as an editable table.
Private Sub AddTable(ByVal sld As Object, ByVal headers As Variant, ByRef rows As Variant, ByVal nRows As Long, ByVal x As Single, ByVal y As Single, ByVal w As Single, ByVal h As Single, ByVal rightCols As String)
    Dim r As Long, c As Long, nCols As Long, rg As Range, shp As Object
    nCols = UBound(headers) - LBound(headers) + 1
    work.Cells.Clear
    For c = 1 To nCols
        work.Cells(1, c).Value = headers(c - 1 + LBound(headers))
    Next c
    For r = 1 To nRows
        For c = 1 To nCols
            work.Cells(r + 1, c).Value = rows(r, c)
        Next c
    Next r
    Set rg = work.Range(work.Cells(1, 1), work.Cells(nRows + 1, nCols))
    rg.Font.Name = "Calibri"
    rg.Font.Size = 9
    rg.Rows(1).Font.Bold = True
    rg.Rows(1).Font.Color = RGB(255, 255, 255)
    rg.Rows(1).Interior.Color = RGBHex(accents((accentIdx - 1) Mod (UBound(accents) + 1)))
    For c = 1 To nCols
        If InStr("," & rightCols & ",", "," & c & ",") > 0 Then
            rg.Columns(c).HorizontalAlignment = xlRight
            rg.Columns(c).NumberFormat = "#,##0;(#,##0)"
        End If
    Next c
    rg.Borders.LineStyle = xlContinuous
    rg.Borders.Color = RGB(214, 220, 229)
    rg.Copy
    DoEvents
    Set shp = sld.Shapes.Paste
    Application.CutCopyMode = False
    With shp
        .Left = x
        .Top = y
        If .Width > w Then .Width = w
        If .Height > h Then .Height = h
    End With
    Animate shp
End Sub

Private Sub AddBullets(ByVal sld As Object, ByVal items As Variant, ByVal n As Long, ByVal x As Single, ByVal y As Single, ByVal w As Single, ByVal h As Single, ByVal size As Single)
    Dim shp As Object, i As Long, s As String
    For i = 1 To n
        s = s & IIf(i > 1, vbCr, "") & items(i)
    Next i
    Set shp = sld.Shapes.AddShape(5, x, y, w, h)
    shp.Fill.ForeColor.RGB = RGBHex("F7F9FC")
    shp.Line.ForeColor.RGB = RGBHex("D6DCE5")
    shp.Adjustments(1) = 0.03
    Animate shp
    Set shp = AddText(sld, s, x + 8, y + 8, w - 16, h - 16, size, False, "172033", True)
    shp.TextFrame.TextRange.ParagraphFormat.Bullet.Visible = -1
    shp.TextFrame.TextRange.ParagraphFormat.Bullet.Character = 9632
    shp.TextFrame.TextRange.ParagraphFormat.SpaceAfter = 6
End Sub

' ---- data helpers ----------------------------------------------------------------------------

Private Function TableRows(ByVal tableName As String, ByVal cols As Variant, ByVal filterCol As String, ByVal filterVal As String, ByVal sortCol As String, ByVal maxRows As Long, ByRef out As Variant) As Long
    ' rows of a table (selected columns) filtered by one column, sorted descending by a numeric column
    Dim lo As ListObject, n As Long, i As Long, c As Long, idx() As Long, keep() As Long, k As Long, tmp As Variant, j As Long, sc As Long, fc As Long
    Set lo = TableOf(tableName)
    n = RowCountOf(lo)
    ReDim idx(0 To UBound(cols))
    For c = 0 To UBound(cols)
        idx(c) = ColIndex(lo, CStr(cols(c)))
    Next c
    If Len(sortCol) > 0 Then sc = ColIndex(lo, sortCol)
    If Len(filterCol) > 0 Then fc = ColIndex(lo, filterCol)
    ReDim keep(1 To n + 1)
    k = 0
    For i = 1 To n
        If Len(filterCol) = 0 Then
            k = k + 1: keep(k) = i
        ElseIf StrComp(Trim$(CStr(Nz(lo.DataBodyRange.Cells(i, fc).Value))), filterVal, vbTextCompare) = 0 Then
            k = k + 1: keep(k) = i
        End If
    Next i
    ' sort kept rows by the sort column, descending
    If sc > 0 And k > 1 Then
        For i = 1 To k - 1
            For j = i + 1 To k
                If CDbl(Nz(lo.DataBodyRange.Cells(keep(j), sc).Value, 0)) > CDbl(Nz(lo.DataBodyRange.Cells(keep(i), sc).Value, 0)) Then
                    tmp = keep(i): keep(i) = keep(j): keep(j) = tmp
                End If
            Next j
        Next i
    End If
    If k > maxRows Then k = maxRows
    ReDim out(1 To IIf(k = 0, 1, k), 1 To UBound(cols) + 1)
    For i = 1 To k
        For c = 0 To UBound(cols)
            tmp = lo.DataBodyRange.Cells(keep(i), idx(c)).Value
            If VarType(tmp) = vbDate Then tmp = Format$(tmp, "dd-mmm-yy")
            If VarType(tmp) = vbString Then If Len(tmp) > 60 Then tmp = Left$(tmp, 58) & "..."
            out(i, c + 1) = tmp
        Next c
    Next i
    TableRows = k
End Function

Private Function CountIf(ByVal tableName As String, ByVal col As String, ByVal value As String) As Long
    On Error Resume Next
    CountIf = Application.WorksheetFunction.CountIf(TableOf(tableName).ListColumns(ColIndex(TableOf(tableName), col)).DataBodyRange, value)
End Function

Private Function SumIf(ByVal tableName As String, ByVal sumCol As String, ByVal col As String, ByVal value As String) As Double
    On Error Resume Next
    Dim lo As ListObject
    Set lo = TableOf(tableName)
    SumIf = Application.WorksheetFunction.SumIf(lo.ListColumns(ColIndex(lo, col)).DataBodyRange, value, lo.ListColumns(ColIndex(lo, sumCol)).DataBodyRange)
End Function

' ---- the deck ----------------------------------------------------------------------------------

Public Sub BuildPresentation()
    If Not IsSignedIn() Then Exit Sub
    Dim path As Variant, base As String
    base = DefaultFolder()
    path = SaveAsName(base & PathSep() & "Cost Report Presentation No " & CStr(NamedValue("CurrentReportNo")) & ".pptx", "PowerPoint (*.pptx), *.pptx", "Save the presentation")
    If Len(CStr(path)) = 0 Then Exit Sub
    On Error GoTo fail
    Set pptApp = CreateObject("PowerPoint.Application")
    On Error GoTo fail2
    Busy True, "Building the presentation..."
    Application.ScreenUpdating = True
    pptApp.Visible = -1
    Set pres = pptApp.Presentations.Add
    pres.PageSetup.SlideWidth = SLIDE_W
    pres.PageSetup.SlideHeight = SLIDE_H
    accents = Array("EB6834", "0E7C86", "2A78D6", "C9A227", "7C5CBF", "2E9E5B", "D64545")
    accentIdx = 0
    slideNo = 0
    Set work = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
    work.Name = "_ppt_work"
    work.Visible = xlSheetHidden
    TitleSlide
    ExecutiveSlide
    Level1Slide
    If CDbl(Nz(NamedValue("PrevReportNo"), 0)) > 0 Then MovementSlide
    ChangesSlide
    EarlyWarningsSlide
    ClaimsSlide
    PaymentsSlide
    BondsSlide
    ProvisionalSumsSlide
    KeyIssuesSlide
    pres.SaveAs CStr(path)
    On Error Resume Next
    pres.SaveAs Left$(CStr(path), Len(CStr(path)) - 5) & ".pdf", PP_SAVE_PDF
    pres.SaveAs CStr(path)
    On Error GoTo fail2
    Application.DisplayAlerts = False
    work.Delete
    Application.DisplayAlerts = True
    Busy False
    LogActivity "Presentation built", CStr(path)
    modReports.AddToLibrary "PowerPoint presentation", CStr(path)
    MsgBox "Presentation saved:" & vbCrLf & path & vbCrLf & "(and the same slides as a PDF next to it)", vbInformation, APP_TITLE
    Exit Sub
fail:
    Busy False
    MsgBox "PowerPoint is not available on this PC, so the presentation cannot be built here. The website's PowerPoint button produces the same deck.", vbExclamation, APP_TITLE
    Exit Sub
fail2:
    Busy False
    On Error Resume Next
    Application.DisplayAlerts = False
    work.Delete
    Application.DisplayAlerts = True
    MsgBox "The presentation stopped: " & Err.Description, vbExclamation, APP_TITLE
End Sub

Private Sub TitleSlide()
    Dim sld As Object, shp As Object
    slideNo = slideNo + 1
    Set sld = pres.Slides.Add(slideNo, PP_LAYOUT_BLANK)
    sld.SlideShowTransition.EntryEffect = PP_EFFECT_FADE
    Set shp = sld.Shapes.AddShape(1, 0, 0, SLIDE_W, SLIDE_H)
    shp.Fill.ForeColor.RGB = RGBHex("1F3A5F")
    shp.Line.Visible = 0
    Set shp = sld.Shapes.AddShape(1, 0, 0, 24, SLIDE_H)
    shp.Fill.ForeColor.RGB = RGBHex("EB6834")
    shp.Line.Visible = 0
    Set shp = sld.Shapes.AddShape(9, 700, -110, 370, 370)
    shp.Fill.ForeColor.RGB = RGBHex("0E7C86")
    shp.Fill.Transparency = 0.7
    shp.Line.Visible = 0
    Set shp = sld.Shapes.AddShape(9, 810, 70, 240, 240)
    shp.Fill.ForeColor.RGB = RGBHex("EB6834")
    shp.Fill.Transparency = 0.55
    shp.Line.Visible = 0
    AddText sld, UCase$(APP_TITLE), 64, 70, 600, 24, 12, False, "9FB3C8", True
    AddText sld, "Monthly Cost Report", 64, 100, 700, 70, 44, True, "FFFFFF", True
    AddText sld, CStr(Nz(NamedValue("CurrentPeriodLabel"))) & "  -  cut-off " & Format$(Nz(NamedValue("CurrentPeriodEnd"), Date), "dd-mmm-yy"), 64, 180, 700, 34, 20, False, "DCE6F2", True
    Set shp = sld.Shapes.AddShape(1, 64, 250, 160, 6)
    shp.Fill.ForeColor.RGB = RGBHex("EB6834")
    shp.Line.Visible = 0
    AddText sld, CStr(Nz(NamedValue("ProgrammeName"))), 64, 290, 700, 30, 18, True, "FFFFFF", True
    AddText sld, CStr(Nz(NamedValue("AssetCode"))) & " - " & CStr(Nz(NamedValue("AssetName"))) & vbCr & CStr(Nz(NamedValue("ClientName"))) & " - " & CStr(Nz(NamedValue("LocationName"))), 64, 322, 700, 44, 13, False, "C7D3E2", True
    AddText sld, IIf(LCase$(CStr(Nz(NamedValue("CurrentPeriodStatus")))) = "locked", "Issued report", "Draft - period not yet locked") & " - prepared by the Commercial Management team - " & Format$(Date, "dd-mmm-yy"), 64, 440, 800, 24, 12, True, "FFFFFF", True
    AddText sld, "Report No " & CStr(Nz(NamedValue("CurrentReportNo"))) & "  -  Confidential", 64, 490, 600, 20, 10, False, "9FB3C8", False
End Sub

Private Sub ExecutiveSlide()
    Dim sld As Object, items(1 To 6) As String, n As Long
    Set sld = NewSlide("Executive Summary", "Cost position at a glance")
    AddTile sld, 1, 6, "Approved baseline budget", Money(L1("E")), "column E", "1F3A5F"
    AddTile sld, 2, 6, "Latest budget", Money(L1("G")), "E + transfers", "0E7C86"
    AddTile sld, 3, 6, "Anticipated final account", Money(L1("N")), "column N", "EB6834"
    AddTile sld, 4, 6, "Variance to budget", Money(L1("O")), IIf(L1("O") > 0, "over budget", IIf(L1("O") < 0, "under budget", "on budget")), IIf(L1("O") > 0, "D64545", "2E9E5B")
    AddTile sld, 5, 6, "Certified to date", Money(L1("P")), IIf(L1("N") <> 0, Format$(L1("P") / L1("N"), "0%") & " of AFA", ""), "7C5CBF"
    If CDbl(Nz(NamedValue("PrevReportNo"), 0)) > 0 Then
        AddTile sld, 6, 6, "Period movement", Money(L1("S")), "vs Report No " & CStr(NamedValue("PrevReportNo")), IIf(L1("S") > 0, "D64545", IIf(L1("S") < 0, "2E9E5B", "2A78D6"))
    Else
        AddTile sld, 6, 6, "Works to complete", Money(L1("Q")), "AFA less certified", "2A78D6"
    End If
    n = 0
    n = n + 1: items(n) = "Anticipated Final Account of SAR " & Money(L1("N")) & " against a latest budget of SAR " & Money(L1("G")) & ": " & IIf(L1("O") = 0, "on budget", "SAR " & Money(Abs(L1("O"))) & IIf(L1("G") <> 0, " (" & Format$(Abs(L1("O")) / L1("G"), "0%") & ")", "") & IIf(L1("O") > 0, " over", " under") & " budget") & "."
    If CDbl(Nz(NamedValue("PrevReportNo"), 0)) > 0 Then n = n + 1: items(n) = "Movement since Report No " & CStr(NamedValue("PrevReportNo")) & ": " & IIf(L1("S") = 0, "no change", IIf(L1("S") > 0, "increase", "decrease") & " of SAR " & Money(Abs(L1("S")))) & "."
    n = n + 1: items(n) = "Certified to date SAR " & Money(L1("P")) & IIf(L1("N") <> 0, " (" & Format$(L1("P") / L1("N"), "0%") & " of the anticipated final account)", "") & "; works to complete SAR " & Money(L1("Q")) & "."
    n = n + 1: items(n) = CountIf("tblChanges", "Closed", "No") & " open change items carried at SAR " & Money(L1("H") + L1("J") + L1("K")) & " (DVO, PVO and RFC); " & CountIf("tblEW", "Status", "Open") & " open early warnings at SAR " & Money(SumIf("tblEW", "Cost impact", "Status", "Open")) & "."
    n = n + 1: items(n) = CountIf("tblClaims", "Status", "Pending") & " pending claims (SAR " & Money(SumIf("tblClaims", "Contractor cost", "Status", "Pending")) & " claimed)."
    n = n + 1: items(n) = "Bonds & insurance: " & CountIf("tblBonds", "Status", "Expired") & " expired on live contracts, " & CountIf("tblBonds", "Status", "Expiring") & " expiring within 60 days."
    AddSectionTitle sld, "Headlines", 32, 182, 430
    AddBullets sld, items, n, 32, 206, 430, 300, 11
    AddSectionTitle sld, "Anticipated final account build-up", 490, 182, 430
    AddHomeChart sld, 1, 490, 206, 438, 300
End Sub

Private Sub Level1Slide()
    Dim sld As Object, ws As Worksheet, hdrRow As Long, lastRow As Long, rg As Range, shp As Object, r As Long, keys As Variant, rows As Variant, k As Long, i As Long, ncat As Long, c As Long
    Set sld = NewSlide("Cost Report - Level 1 (Executive)", "By cost category, executive view (budget includes the unallocated hold; other lines exclude it)")
    Set ws = ThisWorkbook.Worksheets("Level 1")
    keys = Array("G", "awards", "H", "J", "K", "L", "M", "N", "O", "P")
    ncat = 0
    Do While Len(CStr(Nz(ws.Cells(4, 2 + ncat).Value))) > 0 And ws.Cells(4, 2 + ncat).Value <> "Total"
        ncat = ncat + 1
    Loop
    Dim headers() As Variant
    ReDim headers(0 To ncat + 2)
    headers(0) = "SAR"
    For c = 1 To ncat
        headers(c) = ws.Cells(4, 1 + c).Value
    Next c
    headers(ncat + 1) = "Total"
    headers(ncat + 2) = "Movement"
    ReDim rows(1 To UBound(keys) + 1, 1 To ncat + 3)
    k = 0
    For i = 0 To UBound(keys)
        r = CLng(Nz(ThisWorkbook.Names("L1_" & keys(i)).RefersToRange.Row, 0))
        If r > 0 Then
            k = k + 1
            rows(k, 1) = ws.Cells(r, 1).Value
            For c = 1 To ncat
                rows(k, 1 + c) = ws.Cells(r, 1 + c).Value
            Next c
            rows(k, ncat + 2) = ws.Cells(r, ncat + 2).Value
            rows(k, ncat + 3) = ws.Cells(r, ncat + 4).Value
        End If
    Next i
    Dim rightCols As String
    rightCols = ""
    For c = 2 To ncat + 3
        rightCols = rightCols & IIf(Len(rightCols) > 0, ",", "") & c
    Next c
    AddTable sld, headers, rows, k, 32, 90, SLIDE_W - 64, 230, rightCols
    AddSectionTitle sld, "Development budget vs anticipated final account by category", 32, 330, 600
    AddHomeChart sld, 2, 32, 352, SLIDE_W - 64, 160
End Sub

Private Sub MovementSlide()
    Dim sld As Object, ws As Worksheet, first As Long, n As Long, i As Long, rows As Variant, k As Long, headers As Variant, tmp As Variant, j As Long, idx() As Long, r As Long
    Set sld = NewSlide("Movement since the previous report", "Report No " & CStr(NamedValue("PrevReportNo")) & " to " & CStr(NamedValue("CurrentPeriodLabel")))
    AddTile sld, 1, 4, "AFA - previous report", Money(L1("prevN")), "Report No " & CStr(NamedValue("PrevReportNo")), "1F3A5F"
    AddTile sld, 2, 4, "AFA - this report", Money(L1("N")), CStr(NamedValue("CurrentPeriodLabel")), "EB6834"
    AddTile sld, 3, 4, "Period movement", Money(L1("S")), "", IIf(L1("S") > 0, "D64545", IIf(L1("S") < 0, "2E9E5B", "2A78D6"))
    AddTile sld, 4, 4, "Variance to budget", Money(L1("O")), "this report", IIf(L1("O") > 0, "D64545", "2E9E5B")
    ' the largest line movements from the Movement sheet
    Set ws = ThisWorkbook.Worksheets("Movement")
    first = CLng(ws.Range("MovementFirstRow").Value)
    n = RowCountOf(TableOf("tblLevel2"))
    ReDim idx(1 To n + 1)
    k = 0
    For i = 0 To n - 1
        If CDbl(Nz(ws.Cells(first + i, 6).Value, 0)) <> 0 Then
            k = k + 1: idx(k) = first + i
        End If
    Next i
    For i = 1 To k - 1
        For j = i + 1 To k
            If Abs(CDbl(Nz(ws.Cells(idx(j), 6).Value, 0))) > Abs(CDbl(Nz(ws.Cells(idx(i), 6).Value, 0))) Then
                tmp = idx(i): idx(i) = idx(j): idx(j) = tmp
            End If
        Next j
    Next i
    If k > 10 Then k = 10
    headers = Array("Code", "Cost line", "Package", "Previous", "This report", "Movement", "What happened")
    ReDim rows(1 To IIf(k = 0, 1, k), 1 To 7)
    For i = 1 To k
        r = idx(i)
        rows(i, 1) = ws.Cells(r, 1).Value
        rows(i, 2) = Left$(CStr(Nz(ws.Cells(r, 2).Value)), 50)
        rows(i, 3) = Left$(CStr(Nz(ws.Cells(r, 3).Value)), 30)
        rows(i, 4) = ws.Cells(r, 4).Value
        rows(i, 5) = ws.Cells(r, 5).Value
        rows(i, 6) = ws.Cells(r, 6).Value
        rows(i, 7) = ws.Cells(r, 7).Value
    Next i
    AddSectionTitle sld, "Largest line movements", 32, 182, 600
    If k > 0 Then AddTable sld, headers, rows, k, 32, 206, SLIDE_W - 64, 300, "4,5,6" Else AddText sld, "No line moved since the previous report.", 32, 206, 600, 20, 11, False, "6B7280", True
End Sub

Private Sub ChangesSlide()
    Dim sld As Object, rows As Variant, k As Long
    Set sld = NewSlide("Change Management", "Variations, RFCs and their cost report effect")
    AddTile sld, 1, 5, "Change items", CStr(RowCountOf(TableOf("tblChanges"))), "", "1F3A5F"
    AddTile sld, 2, 5, "Open", CStr(CountIf("tblChanges", "Closed", "No")), "", "2A78D6"
    AddTile sld, 3, 5, "Determined VOs (H)", Money(L1("H")), "", "0E7C86"
    AddTile sld, 4, 5, "Potential VOs (J)", Money(L1("J")), "", "7C5CBF"
    AddTile sld, 5, 5, "RFCs (K)", Money(L1("K")), "", "C9A227"
    AddSectionTitle sld, "Status by stage", 32, 182, 300
    AddHomeChart sld, 4, 32, 206, 300, 300
    AddSectionTitle sld, "Largest open change items (cost report amount)", 350, 182, 570
    k = TableRows("tblChanges", Array("Item No", "Description", "Feed column", "Overall status", "Contractor", "Feed amount"), "Closed", "No", "Feed amount", 10, rows)
    If k > 0 Then AddTable sld, Array("Item", "Description", "Col", "Status", "Contractor", "Amount (SAR)"), rows, k, 350, 206, 578, 300, "6" Else AddText sld, "No open change items.", 350, 206, 500, 20, 11, False, "6B7280", True
End Sub

Private Sub EarlyWarningsSlide()
    Dim sld As Object, rows As Variant, k As Long
    Set sld = NewSlide("Early Warnings & Risks", "Potential cost and time exposure not yet instructed")
    AddTile sld, 1, 4, "Early warnings", CStr(RowCountOf(TableOf("tblEW"))), "", "1F3A5F"
    AddTile sld, 2, 4, "Open", CStr(CountIf("tblEW", "Status", "Open")), "", "2A78D6"
    AddTile sld, 3, 4, "Open cost exposure (L)", Money(SumIf("tblEW", "Cost impact", "Status", "Open")), "", "EB6834"
    AddTile sld, 4, 4, "Open risks", CStr(CountIf("tblRisks", "Status", "Open") + CountIf("tblRisks", "Status", "Mitigating")), "risk register", "D64545"
    AddSectionTitle sld, "Open early warnings by cost impact", 32, 182, 600
    k = TableRows("tblEW", Array("EW No", "Description", "Contractor", "Likelihood", "Cost impact", "Time impact (days)"), "Status", "Open", "Cost impact", 10, rows)
    If k > 0 Then AddTable sld, Array("EW No", "Description", "Contractor", "Likelihood", "Cost impact", "Time (days)"), rows, k, 32, 206, SLIDE_W - 64, 300, "5,6" Else AddText sld, "No open early warnings.", 32, 206, 500, 20, 11, False, "6B7280", True
End Sub

Private Sub ClaimsSlide()
    Dim sld As Object, rows As Variant, k As Long
    Set sld = NewSlide("Claims & Disputes", "Claims tracker position")
    AddTile sld, 1, 5, "Claims", CStr(RowCountOf(TableOf("tblClaims"))), "", "1F3A5F"
    AddTile sld, 2, 5, "Pending", CStr(CountIf("tblClaims", "Status", "Pending")), "", "2A78D6"
    AddTile sld, 3, 5, "SAR claimed", Money(Application.WorksheetFunction.Sum(TableOf("tblClaims").ListColumns(ColIndex(TableOf("tblClaims"), "Contractor cost")).DataBodyRange)), "", "EB6834"
    AddTile sld, 4, 5, "SAR determined", Money(Application.WorksheetFunction.Sum(TableOf("tblClaims").ListColumns(ColIndex(TableOf("tblClaims"), "Determination cost")).DataBodyRange)), "", "0E7C86"
    AddTile sld, 5, 5, "Carried in cost report (M)", Money(L1("M")), "", "7C5CBF"
    AddSectionTitle sld, "Claimed and determined by status", 32, 182, 300
    AddHomeChart sld, 5, 32, 206, 300, 300
    AddSectionTitle sld, "Claims by value", 350, 182, 570
    k = TableRows("tblClaims", Array("Claim No", "Description", "Contractor", "Status", "Contractor cost", "Determination cost"), "", "", "Contractor cost", 10, rows)
    If k > 0 Then AddTable sld, Array("Claim", "Description", "Contractor", "Status", "Claimed (SAR)", "Determined (SAR)"), rows, k, 350, 206, 578, 300, "5,6" Else AddText sld, "No claims recorded.", 350, 206, 500, 20, 11, False, "6B7280", True
End Sub

Private Sub PaymentsSlide()
    Dim sld As Object, rows As Variant, k As Long, lo As ListObject
    Set sld = NewSlide("Invoices, Payments & Cash Flow", "Certification and payment progress")
    Set lo = TableOf("tblContracts")
    AddTile sld, 1, 4, "Certified to date (P)", Money(L1("P")), "", "EB6834"
    AddTile sld, 2, 4, "Net paid to date", Money(Application.WorksheetFunction.Sum(lo.ListColumns(ColIndex(lo, "Net paid")).DataBodyRange)), "", "2E9E5B"
    AddTile sld, 3, 4, "Works to complete (Q)", Money(L1("Q")), "", "7C5CBF"
    AddTile sld, 4, 4, "Contracts", CStr(RowCountOf(lo)), "", "1F3A5F"
    AddSectionTitle sld, "Cash flow - cumulative forecast vs actual", 32, 182, 420
    AddHomeChart sld, 6, 32, 206, 420, 300
    AddSectionTitle sld, "Payment status by contract", 470, 182, 460
    k = TableRows("tblContracts", Array("Title", "Contractor", "Status", "Revised value", "Latest certified", "Net paid"), "", "", "Revised value", 9, rows)
    If k > 0 Then AddTable sld, Array("Contract", "Contractor", "Status", "Revised value", "Certified", "Paid"), rows, k, 470, 206, 458, 300, "4,5,6"
End Sub

Private Sub BondsSlide()
    Dim sld As Object, rows As Variant, k As Long
    Set sld = NewSlide("Bonds & Insurance", "Securities held against the contract requirements")
    AddTile sld, 1, 4, "Bonds & policies", CStr(RowCountOf(TableOf("tblBonds"))), "", "1F3A5F"
    AddTile sld, 2, 4, "Expired on live contracts", CStr(CountIf("tblBonds", "Status", "Expired")), "", "D64545"
    AddTile sld, 3, 4, "Expiring within 60 days", CStr(CountIf("tblBonds", "Status", "Expiring")), "", "C9A227"
    AddTile sld, 4, 4, "Released (contract closed)", CStr(CountIf("tblBonds", "Status", "Released*")), "", "0E7C86"
    AddSectionTitle sld, "Portfolio status", 32, 182, 300
    AddHomeChart sld, 3, 32, 206, 300, 300
    AddSectionTitle sld, "Expired and expiring on live contracts", 350, 182, 570
    k = TableRows("tblBonds", Array("Ref", "Type", "Contractor", "Expiry date", "Days to expiry", "Status"), "", "", "", 40, rows)
    ' keep only expired / expiring rows
    Dim keep As Variant, i As Long, n As Long, c As Long
    ReDim keep(1 To IIf(k = 0, 1, k), 1 To 6)
    n = 0
    For i = 1 To k
        If Left$(CStr(Nz(rows(i, 6))), 5) = "Expir" Then
            n = n + 1
            For c = 1 To 6
                keep(n, c) = rows(i, c)
            Next c
        End If
        If n = 12 Then Exit For
    Next i
    If n > 0 Then AddTable sld, Array("Ref", "Type", "Contractor", "Expiry", "Days", "Status"), keep, n, 350, 206, 578, 300, "5" Else AddText sld, "No bonds expired or expiring on live contracts.", 350, 206, 500, 20, 11, False, "6B7280", True
End Sub

Private Sub ProvisionalSumsSlide()
    Dim sld As Object, rows As Variant, k As Long, rows2 As Variant, k2 As Long
    Set sld = NewSlide("Provisional Sums & Budget Transfers", "Provisional sums and approved transfers")
    AddSectionTitle sld, "Provisional sums (SAR)", 32, 90, 500
    k = TableRows("tblPS", Array("Item", "Description", "Status", "Budget", "Contract value", "(Saving) / extra"), "", "", "Budget", 9, rows)
    If k > 0 Then AddTable sld, Array("Item", "Provisional sum", "Status", "Budget", "Contract value", "(Saving) / extra"), rows, k, 32, 114, 520, 380, "4,5,6" Else AddText sld, "No provisional sums recorded.", 32, 114, 500, 20, 11, False, "6B7280", True
    AddSectionTitle sld, "Latest budget transfers (SAR)", 570, 90, 360
    k2 = TableRows("tblTransfers", Array("Item", "Description", "Status", "Amount"), "", "", "Amount", 8, rows2)
    If k2 > 0 Then AddTable sld, Array("Item", "Transfer", "Status", "Amount"), rows2, k2, 570, 114, 358, 380, "4" Else AddText sld, "No budget transfers recorded.", 570, 114, 350, 20, 11, False, "6B7280", True
End Sub

Private Sub KeyIssuesSlide()
    Dim sld As Object, rows As Variant, k As Long, issues As String, items() As String, n As Long, i As Long, lo As ListObject, r As Long, parts() As String
    Set sld = NewSlide("Key Issues & Actions", "Matters for the attention of the Programme Director")
    Set lo = TableOf("tblPeriods")
    r = FindRow(lo, "Report No", CStr(NamedValue("CurrentReportNo")))
    If r > 0 Then issues = CellText(lo, r, "Key issues")
    parts = Split(Replace(issues, vbCr, ""), vbLf)
    ReDim items(1 To UBound(parts) + 2)
    n = 0
    For i = 0 To UBound(parts)
        If Len(Trim$(parts(i))) > 0 Then
            n = n + 1
            items(n) = Trim$(parts(i))
            If Left$(items(n), 1) = "-" Or Left$(items(n), 1) = "-" Then items(n) = Trim$(Mid$(items(n), 2))
        End If
    Next i
    AddSectionTitle sld, "Key issues this period", 32, 90, 430
    If n > 0 Then AddBullets sld, items, n, 32, 114, 430, 380, 12 Else AddText sld, "No key issues recorded for this period (Periods sheet, 'Key issues').", 32, 114, 420, 40, 11, False, "6B7280", True
    AddSectionTitle sld, "Open actions from the commercial meetings", 490, 90, 440
    k = TableRows("tblActions", Array("Item No", "Action", "Owner", "Due date", "Status"), "", "", "", 40, rows)
    Dim keep As Variant, m As Long, c As Long
    ReDim keep(1 To IIf(k = 0, 1, k), 1 To 5)
    m = 0
    For i = 1 To k
        If LCase$(CStr(Nz(rows(i, 5)))) <> "closed" Then
            m = m + 1
            For c = 1 To 5
                keep(m, c) = rows(i, c)
            Next c
        End If
        If m = 10 Then Exit For
    Next i
    If m > 0 Then AddTable sld, Array("No", "Action", "Owner", "Due", "Status"), keep, m, 490, 114, 438, 380, "" Else AddText sld, "No open actions.", 490, 114, 400, 20, 11, False, "6B7280", True
End Sub
