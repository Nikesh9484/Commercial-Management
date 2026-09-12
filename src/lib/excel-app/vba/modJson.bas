Option Explicit
' ------------------------------------------------------------------------------------------
' A small JSON reader / writer (objects -> Dict, arrays -> Collection)
' ------------------------------------------------------------------------------------------

Private jsonText As String
Private jsonPos As Long

Public Function JsonParse(ByVal text As String) As Variant
    jsonText = text
    jsonPos = 1
    SkipWs
    Dim v As Variant
    ParseValue v
    If IsObject(v) Then Set JsonParse = v Else JsonParse = v
End Function

Private Sub SkipWs()
    Do While jsonPos <= Len(jsonText)
        Select Case Mid$(jsonText, jsonPos, 1)
            Case " ", vbTab, vbCr, vbLf: jsonPos = jsonPos + 1
            Case Else: Exit Do
        End Select
    Loop
End Sub

Private Sub ParseValue(ByRef out As Variant)
    Dim ch As String
    SkipWs
    If jsonPos > Len(jsonText) Then Err.Raise vbObjectError + 200, "JsonParse", "Unexpected end of JSON"
    ch = Mid$(jsonText, jsonPos, 1)
    Select Case ch
        Case "{": Set out = ParseObject()
        Case "[": Set out = ParseArray()
        Case """": out = ParseString()
        Case "t": Expect "true": out = True
        Case "f": Expect "false": out = False
        Case "n": Expect "null": out = Null
        Case Else: out = ParseNumber()
    End Select
End Sub

Private Sub Expect(ByVal word As String)
    If Mid$(jsonText, jsonPos, Len(word)) <> word Then Err.Raise vbObjectError + 201, "JsonParse", "Bad JSON near position " & jsonPos
    jsonPos = jsonPos + Len(word)
End Sub

Private Function ParseObject() As Object
    Dim d As Object, key As String, v As Variant
    Set d = New Dict
    jsonPos = jsonPos + 1
    SkipWs
    If Mid$(jsonText, jsonPos, 1) = "}" Then
        jsonPos = jsonPos + 1
        Set ParseObject = d
        Exit Function
    End If
    Do
        SkipWs
        key = ParseString()
        SkipWs
        Expect ":"
        ParseValue v
        If IsObject(v) Then Set d(key) = v Else d(key) = v
        SkipWs
        Select Case Mid$(jsonText, jsonPos, 1)
            Case ",": jsonPos = jsonPos + 1
            Case "}": jsonPos = jsonPos + 1: Exit Do
            Case Else: Err.Raise vbObjectError + 202, "JsonParse", "Bad JSON object near position " & jsonPos
        End Select
    Loop
    Set ParseObject = d
End Function

Private Function ParseArray() As Collection
    Dim c As Collection, v As Variant
    Set c = New Collection
    jsonPos = jsonPos + 1
    SkipWs
    If Mid$(jsonText, jsonPos, 1) = "]" Then
        jsonPos = jsonPos + 1
        Set ParseArray = c
        Exit Function
    End If
    Do
        ParseValue v
        c.Add v
        SkipWs
        Select Case Mid$(jsonText, jsonPos, 1)
            Case ",": jsonPos = jsonPos + 1
            Case "]": jsonPos = jsonPos + 1: Exit Do
            Case Else: Err.Raise vbObjectError + 203, "JsonParse", "Bad JSON array near position " & jsonPos
        End Select
    Loop
    Set ParseArray = c
End Function

Private Function ParseString() As String
    Dim out As String, ch As String, code As String, start As Long
    If Mid$(jsonText, jsonPos, 1) <> """" Then Err.Raise vbObjectError + 204, "JsonParse", "String expected near position " & jsonPos
    jsonPos = jsonPos + 1
    start = jsonPos
    Do While jsonPos <= Len(jsonText)
        ch = Mid$(jsonText, jsonPos, 1)
        If ch = """" Then
            jsonPos = jsonPos + 1
            ParseString = out
            Exit Function
        ElseIf ch = "\" Then
            jsonPos = jsonPos + 1
            ch = Mid$(jsonText, jsonPos, 1)
            Select Case ch
                Case """", "\", "/": out = out & ch
                Case "n": out = out & vbLf
                Case "r": out = out & vbCr
                Case "t": out = out & vbTab
                Case "b": out = out & Chr$(8)
                Case "f": out = out & Chr$(12)
                Case "u"
                    code = Mid$(jsonText, jsonPos + 1, 4)
                    out = out & ChrW$(CLng("&H" & code))
                    jsonPos = jsonPos + 4
            End Select
            jsonPos = jsonPos + 1
        Else
            out = out & ch
            jsonPos = jsonPos + 1
        End If
    Loop
    Err.Raise vbObjectError + 205, "JsonParse", "Unterminated string"
End Function

Private Function ParseNumber() As Variant
    Dim start As Long, ch As String, s As String
    start = jsonPos
    Do While jsonPos <= Len(jsonText)
        ch = Mid$(jsonText, jsonPos, 1)
        If InStr("0123456789+-.eE", ch) = 0 Then Exit Do
        jsonPos = jsonPos + 1
    Loop
    s = Mid$(jsonText, start, jsonPos - start)
    If Len(s) = 0 Then Err.Raise vbObjectError + 206, "JsonParse", "Bad JSON value near position " & start
    ParseNumber = Val(s)
End Function

' ---- reading helpers -----------------------------------------------------------------------

Public Function JGet(ByVal d As Variant, ByVal key As String, Optional ByVal dflt As Variant = "") As Variant
    If IsObject(d) Then
        If TypeName(d) = "Dict" Then
            If d.Exists(key) Then
                If IsObject(d(key)) Then
                    Set JGet = d(key)
                ElseIf IsNull(d(key)) Then
                    JGet = dflt
                Else
                    JGet = d(key)
                End If
                Exit Function
            End If
        End If
    End If
    JGet = dflt
End Function

Public Function JStr(ByVal d As Variant, ByVal key As String) As String
    Dim v As Variant
    v = JGet(d, key, "")
    If IsObject(v) Then JStr = "" Else JStr = Trim$(CStr(v))
End Function

Public Function JNum(ByVal d As Variant, ByVal key As String) As Double
    Dim v As Variant
    v = JGet(d, key, 0)
    If IsNumeric(v) Then JNum = CDbl(v)
End Function

Public Function JArr(ByVal d As Variant, ByVal key As String) As Collection
    Dim v As Variant
    If IsObject(d) Then
        If TypeName(d) = "Dict" Then
            If d.Exists(key) Then
                If TypeName(d(key)) = "Collection" Then
                    Set JArr = d(key)
                    Exit Function
                End If
            End If
        End If
    End If
    Set JArr = New Collection
End Function

' ---- writing ---------------------------------------------------------------------------------

' A JSON string literal (with quotes); non-ASCII escaped so the request body is plain ASCII.
Public Function JsonStr(ByVal s As String) As String
    Dim i As Long, ch As String, code As Long, out As String
    For i = 1 To Len(s)
        ch = Mid$(s, i, 1)
        code = AscW(ch)
        If code < 0 Then code = code + 65536
        Select Case ch
            Case """": out = out & "\"""
            Case "\": out = out & "\\"
            Case vbLf: out = out & "\n"
            Case vbCr: out = out & "\r"
            Case vbTab: out = out & "\t"
            Case Else
                If code < 32 Or code > 126 Then
                    out = out & "\u" & Right$("0000" & Hex$(code), 4)
                Else
                    out = out & ch
                End If
        End Select
    Next i
    JsonStr = """" & out & """"
End Function
