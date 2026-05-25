*** Settings ***
Resource    auth.resource

*** Keywords ***
Go To Admin Page
    Go To    ${BASE_URL}/admin.html
    Wait For Elements State    id=new-album-btn    visible    timeout=8s

Login As Admin And Go To Admin
    Login As Admin
    Go To Admin Page

Create Album
    [Arguments]    ${name}
    Click                       id=new-album-btn
    Wait For Elements State     id=new-album-input    visible    timeout=4s
    Fill Text                   id=new-album-input    ${name}
    Press Keys                  id=new-album-input    Enter
    Wait For Elements State     css=[data-album="${name}"]    visible    timeout=8s

Delete Album
    [Arguments]    ${name}
    Handle Future Dialogs       action=accept
    Click                       css=[data-delete="${name}"]
    Wait For Elements State     css=[data-album="${name}"]    detached    timeout=10s

Delete Album If Exists
    [Arguments]    ${name}
    ${count}=    Get Element Count    css=[data-album="${name}"]
    ${n}=        Convert To Integer    ${count}
    IF    ${n} > 0
        Delete Album    ${name}
    END

Open Upload Modal
    [Arguments]    ${album}
    Click                       css=[data-upload="${album}"]
    Wait For Elements State     id=upload-overlay    visible    timeout=5s

Upload Photos To Album
    [Arguments]    ${album}    @{file_paths}
    Open Upload Modal    ${album}
    FOR    ${path}    IN    @{file_paths}
        Upload File By Selector    id=upload-file-input    ${path}
    END
    Wait For Elements State    css=#upload-file-list .upload-file-item >> nth=0    visible    timeout=4s
    Click                      id=upload-start-btn
    Wait For Elements State    id=upload-overlay    hidden    timeout=30s

API Call As Current User
    [Arguments]    ${method}    ${path}    ${body}=${EMPTY}
    IF    '${body}' != '${EMPTY}'
        ${status}=    Evaluate JavaScript    ${NONE}
        ...    () => fetch('${path}', {method:'${method}',
        ...    headers:{'Content-Type':'application/json'},
        ...    body:'${body}'}).then(r => r.status)
    ELSE
        ${status}=    Evaluate JavaScript    ${NONE}
        ...    () => fetch('${path}', {method:'${method}'}).then(r => r.status)
    END
    RETURN    ${status}
