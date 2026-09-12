Option Explicit
' ------------------------------------------------------------------------------------------
' Stand-alone imports of any workbook whose columns are recognised by their headings:
' Bonds & Insurance, Payment tracking (contracts + IPC log), Final Account Status.
' A heading matches a table column when its letters/digits equal the column name or one of its
' synonyms (the same words the website accepts), or contain them as whole words.
' ------------------------------------------------------------------------------------------

Private Function Synonyms(ByVal tableName As String) As Object
    Dim d As Object
    Set d = New Dict
    Select Case tableName
        Case "tblBonds"
            d.Add "Ref", "ref|no|srno|reference"
            d.Add "Contractor", "contractorconsultant|contractor|consultant"
            d.Add "Package", "package"
            d.Add "Cost line", "costreportline|costline|costcode|cbs"
            d.Add "Original contract sum", "originalcontractsum|contractsum|originalcontract"
            d.Add "Type", "typeofbondinsurance|type|bondtype|insurancetype"
            d.Add "Policy no", "policyno|bondno|policy|policybondno"
            d.Add "Issuer", "issuedbybankinsurer|issuedby|issuer|bankinsurer"
            d.Add "Requirement value", "contractrequirement|requirement|contractrequirementsar|requirementsar|requiredamount|bondrequired|requirementamount|required|contractrequirementvalue"
            d.Add "Requirement type", "requirementtype|contractrequirementtype|requirementbasis"
            d.Add "Amount provided", "amountprovided|provided|bondamount|value"
            d.Add "Start date", "startdate|start|validfrom"
            d.Add "Expiry date", "expirydate|expiry|validuntil"
            d.Add "Contract closed", "contractclosed|contractclosedbondreleased|released"
            d.Add "Approved", "approved|approvedyesno"
            d.Add "Bank verification", "bankverification|verified|bankverificationyesno"
            d.Add "Comments", "comments|remarks|notes"
        Case "tblContracts"
            d.Add "SR No", "srno|sn|no|sr"
            d.Add "PR No", "reefprno|prno|pr"
            d.Add "PO No", "reefpono|pono|po"
            d.Add "ACC ref", "accref|acc|acccode"
            d.Add "Contractor", "contractor|contractorconsultant|supplier|vendor|name"
            d.Add "Package", "package"
            d.Add "Cost line", "costreportline|costline|costcode|cbs"
            d.Add "Title", "title|contract|contracttitle"
            d.Add "Scope", "scopeofwork|scope|description"
            d.Add "Status", "currentstatus|status"
            d.Add "Original completion", "originalcompletiondate|completiondate"
            d.Add "EOT days", "eotgranteddays|eotgranted|eot"
            d.Add "Original contract", "originalcontractsar|originalcontract|contractsum|originalvalue"
            d.Add "FA adjustment", "finalaccountadjustment|faadjustment"
            d.Add "Advance %", "advancerecovery|advance|advancerecoverypct"
            d.Add "Retention %", "retention|retentionpct"
            d.Add "VAT %", "vat|vatpct"
            d.Add "IPC days", "daystoissueipc|ipcdays"
            d.Add "Payment days", "daystopay|paymentdays"
            d.Add "Transaction No", "transactionno|transaction"
            d.Add "Coding", "coding|accountcode"
            d.Add "CBS", "cbs"
            d.Add "Notes", "notes|comments|remarks"
        Case "tblIPC"
            d.Add "Contract", "contract|pono|reefpono|contractor|supplier"
            d.Add "SR", "sr|srno|sn"
            d.Add "Application No", "paymentapplicationno|applicationno|pano|application|ipa"
            d.Add "Month", "month|period"
            d.Add "Application ref", "aconexletterref|applicationaconexref|letterref|applicationref"
            d.Add "Application date", "aconexletterdate|applicationdate|letterdate|date"
            d.Add "Cum. claimed", "cumulativeclaimedexclvat|cumulativeclaimed|cumclaimed"
            d.Add "IPC No", "ipcno|ipc"
            d.Add "IPC ref", "ipcaconexref|ipcref"
            d.Add "IPC date", "ipcdate|ipcaconexdate"
            d.Add "Cum. certified", "cumulativecertified|cumcertified|cumulativecertifiedexclvat"
            d.Add "Invoice ref", "invoiceapprovalaconexref|invoiceref"
            d.Add "Invoice date", "invoiceapprovaldate|invoicedate"
            d.Add "Paid date", "paidbyfinancedate|paiddate|paymentdate|paidon|paidbyfinance"
            d.Add "Comments", "comments|remarks|notes"
        Case "tblFA"
            d.Add "ACC code", "acccode|accref|acc"
            d.Add "Description", "packagedescription|description|package"
            d.Add "Contractor", "contractorconsultant|contractor|consultant"
            d.Add "Type", "type"
            d.Add "Cost line", "costreportline|costline|costcode"
            d.Add "Contract", "contract|pono"
            d.Add "Responsible", "responsible|owner"
            d.Add "Forecast closure", "forecastfaclosure|forecastclosure|forecastclosuredate|targetdate"
            d.Add "Status", "status|fastatus"
            d.Add "FA statement ref", "fastatementref|statementref|faref"
            d.Add "Closed date", "closedsigneddate|closeddate|signeddate"
            d.Add "Comments", "comments|remarks|notes"
    End Select
    Set Synonyms = d
End Function

' Finds the header row: the row (within the first 30) with the most short text cells and few numbers.
Private Function HeaderRowOf(ByRef a As Variant, ByVal rows As Long, ByVal cols As Long) As Long
    Dim r As Long, c As Long, best As Long, bestScore As Long, textN As Long, numN As Long, s As String, limit As Long
    best = 1
    bestScore = -1
    limit = rows
    If limit > 30 Then limit = 30
    For r = 1 To limit
        textN = 0
        numN = 0
        For c = 1 To cols
            s = Txt(a, r, c)
            If Len(s) > 0 Then
                If IsNum(a, r, c) Then
                    numN = numN + 1
                ElseIf Len(s) <= 60 Then
                    textN = textN + 1
                End If
            End If
        Next c
        If textN >= 3 And (textN - numN * 2) > bestScore Then
            bestScore = textN - numN * 2
            best = r
        End If
    Next r
    HeaderRowOf = best
End Function

' Maps table columns to sheet columns; returns a dictionary column name -> sheet column index.
Private Function MapColumns(ByRef a As Variant, ByVal hdr As Long, ByVal cols As Long, ByVal tableName As String) As Object
    Dim syn As Object, map As Object, used As Object, col As Variant, c As Long, n As String, parts() As String, p As Long, score As Long, bestC As Long, bestS As Long
    Set syn = Synonyms(tableName)
    Set map = New Dict
    Set used = New Dict
    For Each col In syn.Keys
        bestC = 0
        bestS = 0
        parts = Split(syn(col), "|")
        For c = 1 To cols
            If Not used.Exists(CStr(c)) Then
                n = NormText(Txt(a, hdr, c))
                If Len(n) > 0 Then
                    score = 0
                    If n = NormText(CStr(col)) Then score = 3
                    For p = 0 To UBound(parts)
                        If n = parts(p) Then score = 3
                        If score < 2 And Len(parts(p)) >= 4 And InStr(1, n, parts(p)) > 0 Then score = 2
                    Next p
                    If score > bestS Then
                        bestS = score
                        bestC = c
                    End If
                End If
            End If
        Next c
        If bestS >= 2 Then
            map.Add CStr(col), bestC
            used.Add CStr(bestC), True
        End If
    Next col
    Set MapColumns = map
End Function

' Imports the best-matching sheet of a workbook into a table. keyColumn identifies existing rows
' (updated), other rows are appended. Returns the number of rows imported.
Private Function ImportInto(ByVal tableName As String, ByVal keyColumn As String, ByVal title As String, ByVal minColumns As Long) As Long
    Dim path As String, wb As Workbook, ws As Worksheet, a As Variant, rows As Long, cols As Long, hdr As Long
    Dim bestWs As Worksheet, bestMap As Object, bestHdr As Long, map As Object, lo As ListObject
    Dim r As Long, key As String, existing As Long, lr As ListRow, col As Variant, v As Variant, n As Long, colType As String, colIdx As Long
    path = PickFile(title, "Excel workbooks", "*.xlsx;*.xlsm;*.xls")
    If Len(path) = 0 Then Exit Function
    Busy True, "Reading " & path & "…"
    On Error GoTo fail
    Set wb = Workbooks.Open(path, ReadOnly:=True, UpdateLinks:=0)
    For Each ws In wb.Worksheets
        If ws.UsedRange.Rows.Count > 1 And ws.UsedRange.Columns.Count > 1 Then
            a = ws.UsedRange.Value
            rows = UBound(a, 1)
            cols = UBound(a, 2)
            hdr = HeaderRowOf(a, rows, cols)
            Set map = MapColumns(a, hdr, cols, tableName)
            If map.Count >= minColumns And map.Exists(keyColumn) Then
                If bestMap Is Nothing Then
                    Set bestWs = ws
                    Set bestMap = map
                    bestHdr = hdr
                ElseIf map.Count > bestMap.Count Then
                    Set bestWs = ws
                    Set bestMap = map
                    bestHdr = hdr
                End If
            End If
        End If
    Next ws
    If bestWs Is Nothing Then
        wb.Close False
        Busy False
        MsgBox "No sheet in that workbook has the columns of " & title & ". The headings must name at least " & minColumns & " of the table's columns, including '" & keyColumn & "'.", vbExclamation, APP_TITLE
        Exit Function
    End If
    Set lo = TableOf(tableName)
    a = bestWs.UsedRange.Value
    rows = UBound(a, 1)
    For r = bestHdr + 1 To rows
        key = Txt(a, r, CLng(bestMap(keyColumn)))
        If Len(key) > 0 And LCase$(Left$(key, 5)) <> "total" And LCase$(Left$(key, 8)) <> "subtotal" Then
            existing = FindRow(lo, keyColumn, key)
            If existing = 0 Then
                Set lr = lo.ListRows.Add
                existing = RowCountOf(lo)
            End If
            For Each col In bestMap.Keys
                colIdx = ColIndex(lo, CStr(col))
                colType = ColumnKind(CStr(col))
                Select Case colType
                    Case "date": v = DateOf(a, r, CLng(bestMap(col)))
                    Case "money": v = MoneyOf(a, r, CLng(bestMap(col)))
                    Case "bool": v = YesNo(YesOf(a, r, CLng(bestMap(col))))
                    Case "contractor": v = CanonicalContractor(Txt(a, r, CLng(bestMap(col))))
                    Case "package": v = CanonicalPackage(Txt(a, r, CLng(bestMap(col))))
                    Case Else: v = Txt(a, r, CLng(bestMap(col)))
                End Select
                If Not IsEmpty(v) Then lo.DataBodyRange.Cells(existing, colIdx).Value = v
            Next col
            If tableName = "tblBonds" Then FixBondRequirement lo, existing
            n = n + 1
        End If
    Next r
    wb.Close False
    ApplyAllFormulas
    Busy False
    LogActivity "Import – " & title, path & " · " & n & " rows from sheet '" & bestWs.Name & "'"
    MsgBox n & " rows imported from sheet '" & bestWs.Name & "' of " & vbCrLf & path, vbInformation, APP_TITLE
    ImportInto = n
    Exit Function
fail:
    Busy False
    On Error Resume Next
    If Not wb Is Nothing Then wb.Close False
    MsgBox "The import stopped: " & Err.Description, vbExclamation, APP_TITLE
End Function

' A workbook "Contract requirement" is usually the SAR amount; a value up to 100 is a percentage.
Private Sub FixBondRequirement(ByVal lo As ListObject, ByVal r As Long)
    Dim v As Variant, t As String
    v = lo.DataBodyRange.Cells(r, ColIndex(lo, "Requirement value")).Value
    t = CellText(lo, r, "Requirement type")
    If IsNumeric(v) And Len(t) = 0 Then
        If CDbl(v) > 100 Then t = "Fixed SAR amount" Else t = "% of contract value"
        lo.DataBodyRange.Cells(r, ColIndex(lo, "Requirement type")).Value = t
    End If
End Sub

Private Function ColumnKind(ByVal col As String) As String
    Dim c As String
    c = LCase$(col)
    If c = "contractor" Then
        ColumnKind = "contractor"
    ElseIf c = "package" Then
        ColumnKind = "package"
    ElseIf c = "approved" Or c = "bank verification" Or c = "contract closed" Then
        ColumnKind = "bool"
    ElseIf InStr(c, "date") > 0 Or c = "original completion" Or c = "forecast closure" Then
        ColumnKind = "date"
    ElseIf InStr(c, "sum") > 0 Or InStr(c, "amount") > 0 Or InStr(c, "value") > 0 Or c = "original contract" Or InStr(c, "cum.") > 0 Or InStr(c, "adjustment") > 0 Or InStr(c, "%") > 0 Or InStr(c, "days") > 0 Or c = "sr no" Or c = "sr" Then
        ColumnKind = "money"
    Else
        ColumnKind = "text"
    End If
End Function

Public Sub ImportBonds()
    If Not RequireEditor() Then Exit Sub
    ImportInto "tblBonds", "Ref", "Bonds & Insurance", 4
End Sub

Public Sub ImportFinalAccounts()
    If Not RequireEditor() Then Exit Sub
    ImportInto "tblFA", "ACC code", "Final Account Status", 3
End Sub

Public Sub ImportPayments()
    If Not RequireEditor() Then Exit Sub
    If MsgBox("Payment tracking is imported in two steps: first the contracts sheet, then the IPC log (payment applications). Continue?", vbOKCancel + vbQuestion, APP_TITLE) <> vbOK Then Exit Sub
    If ImportInto("tblContracts", "PO No", "Contracts – payment summary", 3) > 0 Then
        ImportInto "tblIPC", "Application No", "IPC log (payment applications)", 3
    End If
End Sub
