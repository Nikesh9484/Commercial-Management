Option Explicit
' ------------------------------------------------------------------------------------------
' Claim EAR: the Employer's Assessment Report drafted by the Claude API from the contractor's
' submission, the EAR template and the contract documents, written as a Word document with
' Word (revisions as tracked changes "By Commercial Manager" through Word's compare).
' The prompt, the required JSON shape and the model are the same as the website's
' (stored on the Lists / Setup sheets by the dashboard when this workbook was generated).
' ------------------------------------------------------------------------------------------

Private Const API_URL As String = "https://api.anthropic.com/v1/messages"
Private Const MAX_REQUEST_BYTES As Double = 26000000
Private Const MAX_IMAGES As Long = 8
Private Const WD_HEADING1 As Long = -2
Private Const WD_HEADING2 As Long = -3
Private Const WD_HEADING3 As Long = -4
Private Const WD_NORMAL As Long = -1
Private Const WD_LIST_BULLET As Long = -49
Private Const WD_LIST_NUMBER As Long = -50
Private Const WD_TABLE_GRID As Long = -155

Private blocks As String        ' the JSON content blocks of the user message
Private requestBytes As Double
Private imageCount As Long
Private unreadable As String
Private fileCount As Long

' ---- files ---------------------------------------------------------------------------------

Private Function PickFolder(ByVal title As String) As String
    Dim fd As Object
    Set fd = Application.FileDialog(4) ' msoFileDialogFolderPicker
    fd.Title = title
    fd.AllowMultiSelect = False
    If fd.Show = -1 Then PickFolder = fd.SelectedItems(1)
End Function

Private Function Base64File(ByVal path As String) As String
    Dim stm As Object, bytes() As Byte, dom As Object, node As Object
    Set stm = CreateObject("ADODB.Stream")
    stm.Type = 1
    stm.Open
    stm.LoadFromFile path
    bytes = stm.Read
    stm.Close
    Set dom = CreateObject("MSXML2.DOMDocument.6.0")
    Set node = dom.createElement("b64")
    node.DataType = "bin.base64"
    node.nodeTypedValue = bytes
    Base64File = Replace(Replace(node.Text, vbLf, ""), vbCr, "")
End Function

Private Function FileSize(ByVal path As String) As Double
    On Error Resume Next
    FileSize = FileLen(path)
End Function

Private Function ExtOf(ByVal path As String) As String
    Dim p As Long
    p = InStrRev(path, ".")
    If p > 0 Then ExtOf = LCase$(Mid$(path, p + 1))
End Function

Private Function BaseName(ByVal path As String) As String
    BaseName = Mid$(path, InStrRev(path, "\") + 1)
End Function

Private Sub AddTextBlock(ByVal text As String)
    blocks = blocks & IIf(Len(blocks) > 0, ",", "") & "{""type"":""text"",""text"":" & JsonStr(text) & "}"
    requestBytes = requestBytes + Len(text) * 1.1
End Sub

Private Sub AddPdfBlock(ByVal path As String, ByVal label As String)
    Dim size As Double, b64 As String
    size = FileSize(path)
    If requestBytes + size * 1.37 > MAX_REQUEST_BYTES Then
        unreadable = unreadable & vbLf & BaseName(path) & " – too large for one request (skipped)"
        AddTextBlock "### File: " & label & " (PDF, " & Format$(size / 1048576, "0.0") & " MB – not sent: the request would exceed the size limit)"
        Exit Sub
    End If
    b64 = Base64File(path)
    AddTextBlock "### File: " & label & " (PDF follows)"
    blocks = blocks & ",{""type"":""document"",""source"":{""type"":""base64"",""media_type"":""application/pdf"",""data"":""" & b64 & """},""title"":" & JsonStr(label) & "}"
    requestBytes = requestBytes + Len(b64)
End Sub

Private Sub AddImageBlock(ByVal path As String, ByVal label As String)
    Dim ext As String, mime As String, size As Double, b64 As String
    ext = ExtOf(path)
    Select Case ext
        Case "jpg", "jpeg": mime = "image/jpeg"
        Case "png": mime = "image/png"
        Case "gif": mime = "image/gif"
        Case "webp": mime = "image/webp"
        Case Else: Exit Sub
    End Select
    size = FileSize(path)
    If imageCount >= MAX_IMAGES Or size > 4500000 Or requestBytes + size * 1.37 > MAX_REQUEST_BYTES Then Exit Sub
    b64 = Base64File(path)
    imageCount = imageCount + 1
    AddTextBlock "### Image: " & label
    blocks = blocks & ",{""type"":""image"",""source"":{""type"":""base64"",""media_type"":""" & mime & """,""data"":""" & b64 & """}}"
    requestBytes = requestBytes + Len(b64)
End Sub

' Word / text / Excel files become text; PDFs and images go as they are.
Private Sub AddFile(ByVal wordApp As Object, ByVal path As String, ByVal label As String)
    Dim ext As String, text As String
    ext = ExtOf(path)
    fileCount = fileCount + 1
    Select Case ext
        Case "pdf"
            AddPdfBlock path, label
        Case "jpg", "jpeg", "png", "gif", "webp"
            AddImageBlock path, label
        Case "docx", "doc", "docm", "rtf", "dotx"
            text = WordText(wordApp, path)
            If Len(text) = 0 Then
                unreadable = unreadable & vbLf & label & " – could not be read"
                AddTextBlock "### File: " & label & " (not readable)"
            Else
                AddTextBlock "### File: " & label & " (Word document)" & vbLf & Clip(text, 400000)
            End If
        Case "xlsx", "xlsm", "xls", "csv"
            text = ExcelText(path)
            AddTextBlock "### File: " & label & " (spreadsheet)" & vbLf & Clip(text, 200000)
        Case "txt", "md", "xer", "json", "xml", "htm", "html"
            text = TextFile(path)
            AddTextBlock "### File: " & label & " (text)" & vbLf & Clip(text, 300000)
        Case Else
            unreadable = unreadable & vbLf & label & " – file type not readable (" & ext & ")"
            AddTextBlock "### File: " & label & " (type " & ext & " – not readable)"
    End Select
End Sub

Private Function Clip(ByVal s As String, ByVal maxLen As Long) As String
    If Len(s) <= maxLen Then
        Clip = s
    Else
        Clip = Left$(s, maxLen * 0.8) & vbLf & "[… " & (Len(s) - maxLen) & " characters omitted …]" & vbLf & Right$(s, maxLen * 0.2)
    End If
End Function

Private Function TextFile(ByVal path As String) As String
    On Error Resume Next
    Dim stm As Object
    Set stm = CreateObject("ADODB.Stream")
    stm.Type = 2
    stm.Charset = "utf-8"
    stm.Open
    stm.LoadFromFile path
    TextFile = stm.ReadText
    stm.Close
End Function

Private Function WordText(ByVal wordApp As Object, ByVal path As String) As String
    On Error GoTo bad
    Dim doc As Object, i As Long, s As String
    Set doc = wordApp.Documents.Open(path, ReadOnly:=True, AddToRecentFiles:=False, Visible:=False)
    s = doc.Content.Text
    doc.Close 0
    WordText = Replace(s, Chr$(13), vbLf)
    Exit Function
bad:
    WordText = ""
End Function

Private Function ExcelText(ByVal path As String) As String
    On Error GoTo bad
    Dim wb As Workbook, ws As Worksheet, a As Variant, r As Long, c As Long, line As String, s As String, rows As Long
    Set wb = Workbooks.Open(path, ReadOnly:=True, UpdateLinks:=0)
    For Each ws In wb.Worksheets
        s = s & vbLf & "## Sheet: " & ws.Name & vbLf
        If ws.UsedRange.Rows.Count > 1 Or ws.UsedRange.Columns.Count > 1 Then
            a = ws.UsedRange.Value
            rows = 0
            For r = 1 To UBound(a, 1)
                line = ""
                For c = 1 To UBound(a, 2)
                    line = line & IIf(c > 1, " | ", "") & Txt(a, r, c)
                Next c
                If Len(Replace(line, " | ", "")) > 0 Then
                    s = s & line & vbLf
                    rows = rows + 1
                    If rows > 400 Then Exit For
                End If
            Next r
        End If
    Next ws
    wb.Close False
    ExcelText = s
    Exit Function
bad:
    On Error Resume Next
    wb.Close False
    ExcelText = ""
End Function

' Adds every file of a folder (and its sub-folders) as content blocks.
Private Sub AddFolder(ByVal wordApp As Object, ByVal folder As String, ByVal rel As String, ByVal depth As Long)
    Dim fso As Object, f As Object, sub_ As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    If Not fso.FolderExists(folder) Then Exit Sub
    For Each f In fso.GetFolder(folder).Files
        If Left$(f.Name, 1) <> "~" And Left$(f.Name, 1) <> "." Then
            Application.StatusBar = "Reading " & rel & f.Name & "…"
            DoEvents
            AddFile wordApp, f.path, rel & f.Name
        End If
    Next f
    If depth < 4 Then
        For Each sub_ In fso.GetFolder(folder).SubFolders
            AddFolder wordApp, sub_.path, rel & sub_.Name & "/", depth + 1
        Next sub_
    End If
End Sub

' ---- the template's heading outline ------------------------------------------------------

Private Function TemplateOutline(ByVal wordApp As Object, ByVal path As String) As String
    On Error GoTo bad
    Dim doc As Object, p As Object, st As String, lvl As Long, out As String, t As String
    Set doc = wordApp.Documents.Open(path, ReadOnly:=True, AddToRecentFiles:=False, Visible:=False)
    For Each p In doc.Paragraphs
        st = p.Style
        lvl = 0
        If Left$(st, 9) = "Heading 1" Or st = "Title" Then lvl = 1
        If Left$(st, 9) = "Heading 2" Then lvl = 2
        If Left$(st, 9) = "Heading 3" Then lvl = 3
        If lvl > 0 Then
            t = Trim$(Replace(Replace(p.Range.Text, Chr$(13), ""), Chr$(7), ""))
            If Len(t) > 2 And Not IsNumeric(Replace(t, ".", "")) Then out = out & vbLf & String(2 * (lvl - 1), " ") & "- (level " & lvl & ") " & t
        End If
    Next p
    doc.Close 0
    TemplateOutline = out
    Exit Function
bad:
    TemplateOutline = ""
End Function

' ---- the API call --------------------------------------------------------------------------

Private Function CallClaude(ByVal apiKey As String, ByVal model As String, ByVal system As String, ByVal userBlocks As String, ByVal schema As String) As String
    Dim http As Object, body As String, t0 As Single, resp As String, status As Long
    body = "{""model"":" & JsonStr(model) & ",""max_tokens"":40000,""stream"":true,""thinking"":{""type"":""adaptive""},""system"":" & JsonStr(system) & _
           ",""messages"":[{""role"":""user"",""content"":[" & userBlocks & "]}],""output_config"":{""format"":{""type"":""json_schema"",""schema"":" & schema & "}}}"
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.setTimeouts 30000, 60000, 600000, 3600000
    http.Open "POST", API_URL, True
    http.setRequestHeader "Content-Type", "application/json"
    http.setRequestHeader "x-api-key", apiKey
    http.setRequestHeader "anthropic-version", "2023-06-01"
    http.setRequestHeader "Accept", "text/event-stream"
    http.send body
    t0 = Timer
    Do While http.readyState <> 4
        Application.StatusBar = "Drafting the Employer's Assessment Report… " & Format$((Timer - t0) / 86400, "nn:ss") & " elapsed (usually 3–10 minutes)"
        DoEvents
        Application.Wait Now + TimeSerial(0, 0, 1)
    Loop
    status = http.Status
    resp = http.responseText
    Application.StatusBar = False
    If status <> 200 Then
        Dim errMsg As String
        On Error Resume Next
        errMsg = JStr(JGet(JsonParse(resp), "error"), "message")
        On Error GoTo 0
        Err.Raise vbObjectError + 300, "CallClaude", "The drafting engine returned HTTP " & status & ": " & IIf(Len(errMsg) > 0, errMsg, Left$(resp, 400))
    End If
    CallClaude = AssembleStream(resp)
End Function

' Joins the text deltas of a server-sent-events stream into the final text.
Private Function AssembleStream(ByVal resp As String) As String
    Dim lines() As String, i As Long, line As String, ev As Variant, delta As Variant, out As String, stopReason As String
    lines = Split(Replace(resp, vbCr, ""), vbLf)
    For i = 0 To UBound(lines)
        line = lines(i)
        If Left$(line, 6) = "data: " Then
            line = Mid$(line, 7)
            If InStr(line, """text_delta""") > 0 Or InStr(line, """error""") > 0 Or InStr(line, """message_delta""") > 0 Then
                Set ev = JsonParse(line)
                Select Case JStr(ev, "type")
                    Case "content_block_delta"
                        Set delta = JGet(ev, "delta")
                        If JStr(delta, "type") = "text_delta" Then out = out & JStr(delta, "text")
                    Case "message_delta"
                        stopReason = JStr(JGet(ev, "delta"), "stop_reason")
                    Case "error"
                        Err.Raise vbObjectError + 301, "CallClaude", "The drafting engine reported: " & JStr(JGet(ev, "error"), "message")
                End Select
            End If
        End If
    Next i
    If stopReason = "refusal" Then Err.Raise vbObjectError + 302, "CallClaude", "The drafting engine declined this request (safety refusal). Check the documents and try again."
    If stopReason = "max_tokens" Then Err.Raise vbObjectError + 303, "CallClaude", "The report was cut off (too long for one request). Try with fewer supporting documents."
    If Len(out) = 0 Then Err.Raise vbObjectError + 304, "CallClaude", "The drafting engine returned no text. Response: " & Left$(resp, 300)
    AssembleStream = out
End Function

' ---- Word rendering ------------------------------------------------------------------------

Private Sub Para(ByVal doc As Object, ByVal text As String, ByVal style As Variant, Optional ByVal italic As Boolean = False)
    Dim rg As Object
    Set rg = doc.Content
    rg.Collapse 0
    rg.Text = text
    On Error Resume Next
    rg.Style = style
    If Err.Number <> 0 Then
        Err.Clear
        rg.Style = WD_NORMAL
    End If
    On Error GoTo 0
    rg.Font.Italic = italic
    rg.InsertParagraphAfter
End Sub

Private Sub RenderTable(ByVal doc As Object, ByVal header As Collection, ByVal rows As Collection, ByVal caption As String)
    Dim nCols As Long, nRows As Long, rg As Object, tbl As Object, r As Long, c As Long, row As Variant, i As Long
    nCols = header.Count
    For Each row In rows
        If row.Count > nCols Then nCols = row.Count
    Next row
    If nCols = 0 Then Exit Sub
    nRows = rows.Count + IIf(header.Count > 0, 1, 0)
    If Len(caption) > 0 Then Para doc, caption, "Caption", True
    Set rg = doc.Content
    rg.Collapse 0
    Set tbl = doc.Tables.Add(rg, nRows, nCols)
    On Error Resume Next
    tbl.Style = "Table Grid"
    tbl.Range.Font.Size = 9
    On Error GoTo 0
    r = 0
    If header.Count > 0 Then
        r = 1
        For c = 1 To header.Count
            tbl.Cell(1, c).Range.Text = header(c)
            tbl.Cell(1, c).Range.Font.Bold = True
        Next c
    End If
    For Each row In rows
        r = r + 1
        For c = 1 To row.Count
            If c <= nCols Then tbl.Cell(r, c).Range.Text = row(c)
        Next c
    Next row
    Set rg = doc.Content
    rg.Collapse 0
    rg.InsertParagraphAfter
End Sub

Private Function HeadingStyle(ByVal doc As Object, ByVal level As Long) As Variant
    Select Case level
        Case 1: HeadingStyle = WD_HEADING1
        Case 2: HeadingStyle = WD_HEADING2
        Case Else: HeadingStyle = WD_HEADING3
    End Select
End Function

' Writes the report into a new Word document (based on the template when there is one).
Private Function WriteReport(ByVal wordApp As Object, ByVal ear As Object, ByVal templatePath As String, ByVal outPath As String, ByVal revisionNo As Long) As Object
    Dim doc As Object, m As Variant, sec As Variant, blk As Variant, rows As Collection, hdr As Collection, itm As Variant, i As Long, rg As Object, firstHeading As Object
    If Len(templatePath) > 0 Then
        Set doc = wordApp.Documents.Add(templatePath)
        ' keep the template's cover pages: remove everything from the first heading to the end
        Dim p As Object
        For Each p In doc.Paragraphs
            If Left$(p.Style, 9) = "Heading 1" Then
                Set firstHeading = p.Range
                Exit For
            End If
        Next p
        If Not firstHeading Is Nothing Then
            Set rg = doc.Range(firstHeading.Start, doc.Content.End)
            rg.Delete
        End If
    Else
        Set doc = wordApp.Documents.Add
        Para doc, JStr(ear, "title"), "Title"
        If Len(JStr(ear, "subtitle")) > 0 Then Para doc, JStr(ear, "subtitle"), "Subtitle"
    End If
    ' cover block
    Set hdr = New Collection
    Set rows = New Collection
    For Each m In JArr(ear, "meta")
        Dim pair As Collection
        Set pair = New Collection
        pair.Add JStr(m, "label")
        pair.Add JStr(m, "value")
        rows.Add pair
    Next m
    If revisionNo > 0 Then
        Set pair = New Collection
        pair.Add "Report revision"
        pair.Add "Revision " & Format$(revisionNo, "00")
        rows.Add pair
    End If
    If rows.Count > 0 Then RenderTable doc, hdr, rows, ""
    ' summary
    Dim s As Variant
    Set s = JGet(ear, "summary")
    If IsObject(s) Then
        Para doc, "Summary of assessment", HeadingStyle(doc, 1)
        Set hdr = New Collection
        hdr.Add "": hdr.Add "Claimed": hdr.Add "Assessed"
        Set rows = New Collection
        Set pair = New Collection: pair.Add "Extension of time (days)": pair.Add Format$(JNum(s, "eot_claimed_days"), "#,##0"): pair.Add Format$(JNum(s, "eot_assessed_days"), "#,##0"): rows.Add pair
        Set pair = New Collection: pair.Add "Additional payment (SAR)": pair.Add Format$(JNum(s, "cost_claimed_sar"), "#,##0"): pair.Add Format$(JNum(s, "cost_assessed_sar"), "#,##0"): rows.Add pair
        RenderTable doc, hdr, rows, ""
        If Len(JStr(s, "recommendation")) > 0 Then Para doc, "Recommendation: " & JStr(s, "recommendation"), WD_NORMAL
    End If
    ' sections
    For Each sec In JArr(ear, "sections")
        Para doc, JStr(sec, "heading"), HeadingStyle(doc, CLng(JNum(sec, "level")))
        For Each blk In JArr(sec, "blocks")
            Select Case JStr(blk, "type")
                Case "paragraph": Para doc, JStr(blk, "text"), WD_NORMAL
                Case "note": Para doc, JStr(blk, "text"), WD_NORMAL, True
                Case "bullets"
                    For Each itm In JArr(blk, "items")
                        Para doc, CStr(itm), WD_LIST_BULLET
                    Next itm
                Case "numbered"
                    For Each itm In JArr(blk, "items")
                        Para doc, CStr(itm), WD_LIST_NUMBER
                    Next itm
                Case "table"
                    Set hdr = New Collection
                    For Each itm In JArr(blk, "header")
                        hdr.Add CStr(itm)
                    Next itm
                    Set rows = New Collection
                    For Each itm In JArr(blk, "rows")
                        rows.Add itm
                    Next itm
                    RenderTable doc, hdr, rows, JStr(blk, "caption")
            End Select
        Next blk
    Next sec
    If JArr(ear, "documents_relied_on").Count > 0 Then
        Para doc, "Documents relied on", HeadingStyle(doc, 1)
        For Each itm In JArr(ear, "documents_relied_on")
            Para doc, CStr(itm), WD_LIST_BULLET
        Next itm
    End If
    If JArr(ear, "information_gaps").Count > 0 Then
        Para doc, "Information requested from the Contractor", HeadingStyle(doc, 1)
        For Each itm In JArr(ear, "information_gaps")
            Para doc, CStr(itm), WD_LIST_BULLET
        Next itm
    End If
    On Error Resume Next
    doc.Fields.Update
    For i = 1 To doc.TablesOfContents.Count
        doc.TablesOfContents(i).Update
    Next i
    On Error GoTo 0
    doc.SaveAs2 outPath, 16 ' wdFormatXMLDocument
    Set WriteReport = doc
End Function

' ---- the button -----------------------------------------------------------------------------

Public Sub CreateClaimEar()
    If Not RequireEditor() Then Exit Sub
    Dim apiKey As String, model As String, system As String, schema As String, rules As String
    apiKey = Trim$(CStr(Nz(NamedValue("ApiKey"))))
    model = Trim$(CStr(Nz(NamedValue("EarModel"))))
    If Len(model) = 0 Then model = "claude-opus-5"
    system = CStr(Nz(NamedValue("EarSystemPrompt")))
    schema = CStr(Nz(NamedValue("EarSchema")))
    rules = CStr(Nz(NamedValue("EarRevisionRules")))
    If Len(apiKey) = 0 Then
        MsgBox "No API key. An administrator must enter the Anthropic API key in the 'API key' cell on the Setup sheet (the same key the website uses).", vbExclamation, APP_TITLE
        Exit Sub
    End If
    If Len(schema) = 0 Or Len(system) = 0 Then
        MsgBox "The drafting instructions are missing from this workbook (Setup / Lists sheets). Download the Excel edition again from the website.", vbExclamation, APP_TITLE
        Exit Sub
    End If
    Dim title As String, submission As String, template As String, contracts As String, revised As Boolean, prevEar As String, prevSub As String, contractor As String, contractNo As String, claimRef As String
    title = InputBox("Title of the claim / assessment (used for the file name), e.g. 'EOT-02 Elmar boardwalk':", APP_TITLE & " – Claim EAR")
    If Len(title) = 0 Then Exit Sub
    contractor = InputBox("Contractor (optional):", APP_TITLE)
    contractNo = InputBox("Contract No (optional):", APP_TITLE)
    claimRef = InputBox("Claim reference (optional):", APP_TITLE)
    submission = PickFolder("Folder with the contractor's claim submission and its supporting documents")
    If Len(submission) = 0 Then Exit Sub
    template = PickFile("EAR template (Word) – Cancel if there is none", "Word documents", "*.docx;*.docm;*.dotx")
    If MsgBox("Do you have a folder of contract documents to include (conditions, particular conditions, programme obligations…)?", vbYesNo + vbQuestion, APP_TITLE) = vbYes Then contracts = PickFolder("Folder with the contract documents")
    revised = (MsgBox("Is this a REVISED submission (a previous Employer's Assessment Report exists)?", vbYesNo + vbQuestion, APP_TITLE) = vbYes)
    If revised Then
        prevEar = PickFile("Previous Employer's Assessment Report (Word)", "Word documents", "*.docx;*.docm")
        If Len(prevEar) = 0 Then revised = False
        If revised Then
            If MsgBox("Do you also have the contractor's PREVIOUS submission (before the revision) as a folder?", vbYesNo + vbQuestion, APP_TITLE) = vbYes Then prevSub = PickFolder("Folder with the contractor's previous submission")
        End If
    End If
    Dim revisionNo As Long
    If revised Then
        revisionNo = CLng(Val(InputBox("Revision number of this report:", APP_TITLE, "1")))
        If revisionNo < 1 Then revisionNo = 1
    End If
    Dim wordApp As Object, outline As String, facts As String, prompt As String, jsonText As String, ear As Object, outPath As String, doc As Object, t0 As Single
    On Error GoTo fail
    t0 = Timer
    Set wordApp = CreateObject("Word.Application")
    wordApp.Visible = False
    Busy True, "Reading the documents…"
    Application.ScreenUpdating = True
    blocks = ""
    requestBytes = 0
    imageCount = 0
    unreadable = ""
    fileCount = 0
    facts = "Programme / project: " & CStr(Nz(NamedValue("ProgrammeName"))) & vbLf & "Case title: " & title
    If Len(contractor) > 0 Then facts = facts & vbLf & "Contractor: " & contractor
    If Len(contractNo) > 0 Then facts = facts & vbLf & "Contract No: " & contractNo
    If Len(claimRef) > 0 Then facts = facts & vbLf & "Claim reference: " & claimRef
    facts = facts & vbLf & IIf(revised, "This is a REVISED submission (revision " & revisionNo & "); a previous Employer's Assessment Report exists.", "This is the contractor's first (original) submission.")
    facts = facts & vbLf & "Report date: " & Format$(Date, "yyyy-mm-dd")
    AddTextBlock "# CASE" & vbLf & facts
    If Len(template) > 0 Then
        outline = TemplateOutline(wordApp, template)
        AddTextBlock "# EAR TEMPLATE (structure and wording to follow)"
        AddFile wordApp, template, BaseName(template)
    Else
        AddTextBlock "# EAR TEMPLATE (structure and wording to follow)" & vbLf & "(no template supplied – use the standard Employer's Assessment Report structure: introduction, contractor's submission, contractual basis and notices, assessment of delay, assessment of cost, conclusion and recommendation)"
    End If
    AddTextBlock "# CONTRACTOR'S CLAIM SUBMISSION AND SUPPORTING DOCUMENTS"
    AddFolder wordApp, submission, "", 0
    If Len(contracts) > 0 Then
        AddTextBlock "# CONTRACT DOCUMENTS"
        AddFolder wordApp, contracts, "", 0
    Else
        AddTextBlock "# CONTRACT DOCUMENTS" & vbLf & "(no documents uploaded in this group)"
    End If
    If revised Then
        AddTextBlock "# PREVIOUS EMPLOYER'S ASSESSMENT REPORT (the report this revision is written on top of)"
        AddFile wordApp, prevEar, BaseName(prevEar)
        If Len(prevSub) > 0 Then
            AddTextBlock "# CONTRACTOR'S PREVIOUS SUBMISSION (before the revision)"
            AddFolder wordApp, prevSub, "", 0
        End If
    End If
    prompt = "Now write the complete Employer's Assessment Report for this case as JSON in the required format."
    If revised Then prompt = prompt & vbLf & vbLf & rules
    prompt = prompt & vbLf & "The ""meta"" cover block must include: Project, Employer, Contractor, Contract No, Claim reference, Submission reference / date, Report revision, Report date, Prepared by."
    If Len(outline) > 0 Then prompt = prompt & vbLf & vbLf & "REQUIRED OUTLINE – the Word template's own headings. Use exactly these headings, in this order, with these levels (you may add level 2 or level 3 sub-headings under them; do NOT number the headings, the template numbers them):" & outline
    AddTextBlock prompt
    Busy False
    If MsgBox(fileCount & " files read (" & Format$(requestBytes / 1048576, "0.0") & " MB sent" & IIf(imageCount > 0, ", " & imageCount & " images", "") & ")." & IIf(Len(unreadable) > 0, vbLf & "Not readable:" & unreadable, "") & vbLf & vbLf & "Draft the report now? This usually takes 3–10 minutes; Excel stays busy meanwhile.", vbOKCancel + vbQuestion, APP_TITLE) <> vbOK Then
        wordApp.Quit
        Exit Sub
    End If
    jsonText = CallClaude(apiKey, model, system, blocks, schema)
    blocks = ""
    Set ear = JsonParse(jsonText)
    Application.StatusBar = "Writing the Word document…"
    outPath = submission & "\EAR - " & SafeName(title) & IIf(revised, " - Rev " & Format$(revisionNo, "00"), "") & ".docx"
    Set doc = WriteReport(wordApp, ear, template, outPath, IIf(revised, revisionNo, 0))
    If revised Then
        ' tracked changes against the previous report, by the Commercial Manager
        Dim prevDoc As Object, cmp As Object, trackedPath As String
        Set prevDoc = wordApp.Documents.Open(prevEar, ReadOnly:=True, AddToRecentFiles:=False, Visible:=False)
        wordApp.UserName = "Commercial Manager"
        Set cmp = wordApp.CompareDocuments(prevDoc, doc, 2, 0, False, True, True, True, True, True, True, True, True, True, "Commercial Manager", True)
        trackedPath = Left$(outPath, Len(outPath) - 5) & " (tracked changes).docx"
        cmp.SaveAs2 trackedPath, 16
        prevDoc.Close 0
        doc.Close 0
        Set doc = cmp
        outPath = trackedPath
    End If
    Application.StatusBar = False
    wordApp.Visible = True
    doc.Activate
    LogActivity "Claim EAR drafted", outPath & " · " & fileCount & " files · " & Format$((Timer - t0) / 60, "0") & " min"
    MsgBox "The Employer's Assessment Report is ready:" & vbCrLf & outPath & vbCrLf & vbCrLf & "It is open in Word for review." & IIf(revised, " Changes against the previous report are shown as tracked changes by 'Commercial Manager'.", ""), vbInformation, APP_TITLE
    Exit Sub
fail:
    Busy False
    Application.StatusBar = False
    On Error Resume Next
    If Not wordApp Is Nothing Then
        If wordApp.Documents.Count = 0 Then wordApp.Quit
    End If
    MsgBox "The Claim EAR stopped: " & Err.Description, vbExclamation, APP_TITLE
End Sub

Private Function SafeName(ByVal s As String) As String
    Dim i As Long, ch As String, out As String
    For i = 1 To Len(s)
        ch = Mid$(s, i, 1)
        If InStr("\/:*?""<>|", ch) > 0 Then ch = "-"
        out = out & ch
    Next i
    SafeName = Trim$(out)
End Function
