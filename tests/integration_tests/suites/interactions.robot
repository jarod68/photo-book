*** Settings ***
Resource          ../resources/admin.resource
Suite Setup       Interactions Suite Setup
Suite Teardown    Interactions Suite Teardown

*** Variables ***
${INT_ALBUM}    robot-interactions
${INT_PHOTO}    test-photo-1.png

*** Keywords ***
Interactions Suite Setup
    Login As Admin And Go To Admin
    Delete Album If Exists    ${INT_ALBUM}
    Create Album              ${INT_ALBUM}
    Upload Photos To Album    ${INT_ALBUM}    ${FIXTURE_DIR}/test-photo-1.png

Interactions Suite Teardown
    Run Keyword And Ignore Error    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/${INT_ALBUM}', {method:'DELETE'})
    Close Browser

*** Test Cases ***

POST View Records A View
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/view', {method:'POST',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:JSON.stringify({album:'${INT_ALBUM}', filename:'${INT_PHOTO}', token: crypto.randomUUID()})})
    ...    .then(r => r.json())
    Should Be True    ${data}[views] >= 1

POST View Same Token Does Not Increment Count Twice
    ${same}=    Evaluate JavaScript    ${NONE}
    ...    async () => {
    ...    const token = crypto.randomUUID();
    ...    const body = JSON.stringify({album:'${INT_ALBUM}', filename:'${INT_PHOTO}', token});
    ...    const opts = {method:'POST', headers:{'Content-Type':'application/json'}, body};
    ...    const a = await fetch('/api/view', opts).then(r => r.json());
    ...    const b = await fetch('/api/view', opts).then(r => r.json());
    ...    return a.views === b.views;
    ...    }
    Should Be True    ${same}

POST View Without Token Returns 400
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/view', {method:'POST',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:JSON.stringify({album:'${INT_ALBUM}', filename:'${INT_PHOTO}'})})
    ...    .then(r => r.status)
    Should Be Equal As Integers    ${s}    400

POST Like Adds A Like
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/like', {method:'POST',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:JSON.stringify({album:'${INT_ALBUM}', filename:'${INT_PHOTO}', token: crypto.randomUUID()})})
    ...    .then(r => r.json())
    Should Be True    ${data}[liked]

POST Like Toggle Removes Like
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    async () => {
    ...    const token = crypto.randomUUID();
    ...    const body = JSON.stringify({album:'${INT_ALBUM}', filename:'${INT_PHOTO}', token});
    ...    const opts = {method:'POST', headers:{'Content-Type':'application/json'}, body};
    ...    await fetch('/api/like', opts);
    ...    return fetch('/api/like', opts).then(r => r.json());
    ...    }
    Should Not Be True    ${data}[liked]

GET Liked Returns Filename After Like
    ${filenames}=    Evaluate JavaScript    ${NONE}
    ...    async () => {
    ...    const token = crypto.randomUUID();
    ...    const body = JSON.stringify({album:'${INT_ALBUM}', filename:'${INT_PHOTO}', token});
    ...    const opts = {method:'POST', headers:{'Content-Type':'application/json'}, body};
    ...    await fetch('/api/like', opts);
    ...    const data = await fetch('/api/liked?album=${INT_ALBUM}&token=' + token).then(r => r.json());
    ...    return data.filenames;
    ...    }
    Length Should Be    ${filenames}    1
    Should Be Equal    ${filenames}[0]    ${INT_PHOTO}

GET Liked Returns Empty For Unknown Token
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/liked?album=${INT_ALBUM}&token=' + crypto.randomUUID()).then(r => r.json())
    Length Should Be    ${data}[filenames]    0

POST Like Without Fields Returns 400
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/like', {method:'POST',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:JSON.stringify({album:'${INT_ALBUM}'})})
    ...    .then(r => r.status)
    Should Be Equal As Integers    ${s}    400
