*** Settings ***
Resource          ../resources/admin.resource
Suite Setup       Logs Suite Setup
Suite Teardown    Logs Suite Teardown

*** Variables ***
${LOG_ALBUM}    robot-logs

*** Keywords ***
Logs Suite Setup
    Login As Admin And Go To Admin
    Delete Album If Exists    ${LOG_ALBUM}
    Delete Album If Exists    ${LOG_ALBUM}-2
    Create Album    ${LOG_ALBUM}
    Create Album    ${LOG_ALBUM}-2
    Sleep    0.3s

Logs Suite Teardown
    Run Keyword And Ignore Error    Evaluate JavaScript    ${NONE}
    ...    () => Promise.all(['${LOG_ALBUM}', '${LOG_ALBUM}-2']
    ...    .map(n => fetch('/api/admin/albums/' + n, {method:'DELETE'})))
    Close Browser

*** Test Cases ***

GET Logs Returns Entries
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/logs').then(r => r.json())
    Should Be True    ${data}[total] >= 1
    ${count}=    Get Length    ${data}[logs]
    Should Be True    ${count} >= 1

Filter By Action Returns Only Matching Entries
    ${all_match}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/logs?action=album_create').then(r => r.json())
    ...    .then(d => d.total > 0 && d.logs.every(l => l.action === 'album_create'))
    Should Be True    ${all_match}

Filter Returns Correct Total Count
    ${data_all}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/logs').then(r => r.json())
    ${data_filtered}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/logs?action=album_create').then(r => r.json())
    Should Be True    ${data_filtered}[total] <= ${data_all}[total]

Pagination Limit Param Restricts Results
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/logs?limit=1').then(r => r.json())
    Length Should Be    ${data}[logs]    1
    Should Be Equal As Integers    ${data}[page]    1
    Should Be True    ${data}[pages] >= 1

Pagination Page Param Returns Different Entries
    ${different}=    Evaluate JavaScript    ${NONE}
    ...    async () => {
    ...    const p1 = await fetch('/api/admin/logs?limit=1&page=1').then(r => r.json());
    ...    const p2 = await fetch('/api/admin/logs?limit=1&page=2').then(r => r.json());
    ...    if (!p1.logs.length || !p2.logs.length) return true;
    ...    return p1.logs[0].id !== p2.logs[0].id;
    ...    }
    Should Be True    ${different}

Logs Table Renders In Admin UI
    Go To Admin Page
    Wait For Elements State    css=#logs-body tr >> nth=0    visible    timeout=8s
    ${count}=    Get Element Count    css=#logs-body tr
    Should Be True    ${count} >= 1

DELETE Logs Clears All Entries
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/logs', {method:'DELETE'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    200

After Clear Logs Are Empty
    Sleep    0.3s
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/logs').then(r => r.json())
    Should Be Equal As Integers    ${data}[total]    0
    Length Should Be    ${data}[logs]    0
