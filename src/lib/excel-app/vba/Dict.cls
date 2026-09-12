Option Explicit
' ------------------------------------------------------------------------------------------
' A small key -> value dictionary that works on Windows and on Mac
' (Scripting.Dictionary only exists on Windows). Same members as the Scripting one:
' Add, Exists, Item (default), Keys, Items, Count, Remove, RemoveAll. Keys are case-sensitive.
' ------------------------------------------------------------------------------------------

Private keysCol As Collection   ' the keys, in insertion order
Private valsCol As Collection   ' the values, same positions
Private idxCol As Collection    ' encoded key -> position

Private Sub Class_Initialize()
    RemoveAll
End Sub

' Collection keys compare without case; upper-case letters are marked so "E" and "e" stay different.
Private Function KeyOf(ByVal key As Variant) As String
    Dim s As String, i As Long, ch As String, out As String
    s = CStr(key)
    For i = 1 To Len(s)
        ch = Mid$(s, i, 1)
        If ch = "^" Then
            out = out & "^^"
        ElseIf ch <> LCase$(ch) Then
            out = out & "^" & ch
        Else
            out = out & ch
        End If
    Next i
    KeyOf = "k" & out
End Function

Public Function Exists(ByVal key As Variant) As Boolean
    Dim p As Long
    On Error Resume Next
    p = idxCol.Item(KeyOf(key))
    Exists = (Err.Number = 0)
    On Error GoTo 0
End Function

Public Sub Add(ByVal key As Variant, ByVal value As Variant)
    If Exists(key) Then Err.Raise 457, "Dict", "This key is already associated with an element of this collection"
    keysCol.Add key
    valsCol.Add value
    idxCol.Add keysCol.Count, KeyOf(key)
End Sub

Private Sub SetAt(ByVal key As Variant, ByVal value As Variant)
    Dim p As Long
    p = idxCol.Item(KeyOf(key))
    valsCol.Add value, , p
    valsCol.Remove p + 1
End Sub

Public Property Get Item(ByVal key As Variant) As Variant
Attribute Item.VB_UserMemId = 0
    Dim p As Long
    If Not Exists(key) Then Add key, Empty
    p = idxCol.Item(KeyOf(key))
    If IsObject(valsCol.Item(p)) Then
        Set Item = valsCol.Item(p)
    Else
        Item = valsCol.Item(p)
    End If
End Property

Public Property Let Item(ByVal key As Variant, ByVal value As Variant)
    If Exists(key) Then SetAt key, value Else Add key, value
End Property

Public Property Set Item(ByVal key As Variant, ByVal value As Variant)
    If Exists(key) Then SetAt key, value Else Add key, value
End Property

Public Property Get Count() As Long
    Count = keysCol.Count
End Property

Public Function Keys() As Variant
    Dim out() As Variant, i As Long
    If keysCol.Count = 0 Then
        Keys = Array()
        Exit Function
    End If
    ReDim out(0 To keysCol.Count - 1)
    For i = 1 To keysCol.Count
        out(i - 1) = keysCol.Item(i)
    Next i
    Keys = out
End Function

Public Function Items() As Variant
    Dim out() As Variant, i As Long
    If valsCol.Count = 0 Then
        Items = Array()
        Exit Function
    End If
    ReDim out(0 To valsCol.Count - 1)
    For i = 1 To valsCol.Count
        If IsObject(valsCol.Item(i)) Then Set out(i - 1) = valsCol.Item(i) Else out(i - 1) = valsCol.Item(i)
    Next i
    Items = out
End Function

Public Sub Remove(ByVal key As Variant)
    Dim p As Long, i As Long
    p = idxCol.Item(KeyOf(key))
    keysCol.Remove p
    valsCol.Remove p
    Set idxCol = New Collection
    For i = 1 To keysCol.Count
        idxCol.Add i, KeyOf(keysCol.Item(i))
    Next i
End Sub

Public Sub RemoveAll()
    Set keysCol = New Collection
    Set valsCol = New Collection
    Set idxCol = New Collection
End Sub
