*** Settings ***
Resource          ../resources/admin.resource
Suite Setup       Album Access Suite Setup
Suite Teardown    Album Access Suite Teardown

*** Variables ***
${ACCESS_ALBUM}    robot-restricted
${ADMIN_CTX}       ${EMPTY}
${BASIC_ID}        ${EMPTY}

*** Keywords ***
Album Access Suite Setup
    New Browser    ${BROWSER}    headless=${HEADLESS}
    ${ctx}=    New Context    locale=fr-FR
    Set Suite Variable    ${ADMIN_CTX}    ${ctx}
    New Page    ${BASE_URL}/login.html
    Submit Login Form    ${ADMIN_USER}    ${ADMIN_PASS}
    Wait For Elements State    css=body.page-home    visible    timeout=12s
    Go To Admin Page
    Delete Album If Exists    ${ACCESS_ALBUM}
    Create Album    ${ACCESS_ALBUM}
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/${ACCESS_ALBUM}/settings', {method:'PUT',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:JSON.stringify({visibility:'restricted', userIds:[]})}).then(r => r.status)
    Should Be Equal As Integers    ${s}    200
    ${bid}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/users').then(r => r.json())
    ...    .then(d => d.users.find(u => u.username === '${BASIC_USER}').id)
    Set Suite Variable    ${BASIC_ID}    ${bid}

Album Access Suite Teardown
    Run Keyword And Ignore Error    Switch Context    ${ADMIN_CTX}
    Run Keyword And Ignore Error    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/${ACCESS_ALBUM}', {method:'DELETE'})
    Close Browser

Login As Basic In New Context
    ${ctx}=    New Context    locale=fr-FR
    New Page    ${BASE_URL}/login.html
    Submit Login Form    ${BASIC_USER}    ${BASIC_PASS}
    Wait For Elements State    css=body.page-home    visible    timeout=12s
    RETURN    ${ctx}

*** Test Cases ***

Restricted Album Not In Public Album List
    ${found}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums', {credentials:'omit'}).then(r => r.json())
    ...    .then(d => d.some(a => a.name === '${ACCESS_ALBUM}'))
    Should Not Be True    ${found}

Restricted Album Returns 401 For Anonymous User
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${ACCESS_ALBUM}', {credentials:'omit'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    401

Admin Sees Restricted Album In Album List
    ${found}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums').then(r => r.json())
    ...    .then(d => d.some(a => a.name === '${ACCESS_ALBUM}'))
    Should Be True    ${found}

Admin Can Access Restricted Album
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${ACCESS_ALBUM}').then(r => r.status)
    Should Be Equal As Integers    ${s}    200

GET Settings Returns Restricted Visibility And Empty Users
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/${ACCESS_ALBUM}/settings').then(r => r.json())
    Should Be Equal    ${data}[visibility]    restricted
    Length Should Be    ${data}[users]    0

Basic User Cannot Access Unauthorized Restricted Album
    Login As Basic In New Context
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${ACCESS_ALBUM}').then(r => r.status)
    Should Be Equal As Integers    ${s}    401
    Switch Context    ${ADMIN_CTX}

PUT Settings Adds Authorized User
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/${ACCESS_ALBUM}/settings', {method:'PUT',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:JSON.stringify({visibility:'restricted', userIds:[${BASIC_ID}]})}).then(r => r.status)
    Should Be Equal As Integers    ${s}    200
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/${ACCESS_ALBUM}/settings').then(r => r.json())
    Length Should Be    ${data}[users]    1

Authorized Basic User Can Access Restricted Album
    Login As Basic In New Context
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${ACCESS_ALBUM}').then(r => r.status)
    Should Be Equal As Integers    ${s}    200
    ${found}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums').then(r => r.json())
    ...    .then(d => d.some(a => a.name === '${ACCESS_ALBUM}'))
    Should Be True    ${found}
    Switch Context    ${ADMIN_CTX}
