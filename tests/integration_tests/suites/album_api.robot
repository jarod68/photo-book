*** Settings ***
Resource          ../resources/admin.resource
Suite Setup       Album API Suite Setup
Suite Teardown    Album API Suite Teardown

*** Variables ***
${COVER_ALBUM}     robot-album-api
${DELETE_ALBUM}    robot-album-delete

*** Keywords ***
Album API Suite Setup
    Login As Admin And Go To Admin
    Delete Album If Exists    ${COVER_ALBUM}
    Delete Album If Exists    ${DELETE_ALBUM}
    Create Album    ${COVER_ALBUM}
    Upload Photos To Album    ${COVER_ALBUM}
    ...    ${FIXTURE_DIR}/test-photo-1.png
    ...    ${FIXTURE_DIR}/test-photo-2.png
    Create Album    ${DELETE_ALBUM}
    Upload Photos To Album    ${DELETE_ALBUM}
    ...    ${FIXTURE_DIR}/test-photo-1.png

Album API Suite Teardown
    Run Keyword And Ignore Error    Evaluate JavaScript    ${NONE}
    ...    () => Promise.all(['${COVER_ALBUM}', '${DELETE_ALBUM}', 'robot-empty-cover']
    ...    .map(n => fetch('/api/admin/albums/' + n, {method:'DELETE'})))
    Close Browser

*** Test Cases ***

GET Album Cover Returns Cover URL
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${COVER_ALBUM}/cover').then(r => r.json())
    Should Not Be Empty    ${data}[cover]
    Should Contain    ${data}[cover]    ${COVER_ALBUM}

GET Album Cover Returns 200 Status
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${COVER_ALBUM}/cover').then(r => r.status)
    Should Be Equal As Integers    ${s}    200

GET Album Cover For Unknown Album Returns 404
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/nonexistent-album-xyz/cover').then(r => r.status)
    Should Be Equal As Integers    ${s}    404

GET Empty Album Cover Returns 404
    ${s1}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums', {method:'POST',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:JSON.stringify({name:'robot-empty-cover'})}).then(r => r.status)
    Should Be Equal As Integers    ${s1}    201
    ${s2}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/robot-empty-cover/cover').then(r => r.status)
    Should Be Equal As Integers    ${s2}    404

GET Albums List Includes Cover URL For Album With Photos
    ${album}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums').then(r => r.json())
    ...    .then(albums => albums.find(a => a.name === '${COVER_ALBUM}'))
    Should Not Be Empty    ${album}[cover]

GET Albums List Returns canDelete True For Admin
    ${album}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums').then(r => r.json())
    ...    .then(albums => albums.find(a => a.name === '${COVER_ALBUM}'))
    Should Be True    ${album}[canDelete]

GET Album Returns canDownload True For Authenticated User
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${COVER_ALBUM}').then(r => r.json())
    Should Be True    ${data}[canDownload]

GET Album Returns canDownload False For Anonymous
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${COVER_ALBUM}', {credentials:'omit'}).then(r => r.json())
    Should Not Be True    ${data}[canDownload]

DELETE Photo By Anonymous Returns 401
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${COVER_ALBUM}/photos/test-photo-1.png',
    ...    {method:'DELETE', credentials:'omit'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    401

DELETE Photo By Authenticated Admin Returns 200
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${DELETE_ALBUM}/photos/test-photo-1.png',
    ...    {method:'DELETE'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    200

DELETE Non-Existent Photo Returns 404
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${COVER_ALBUM}/photos/ghost-does-not-exist.jpg',
    ...    {method:'DELETE'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    404

DELETE Non-Image Filename Returns 400
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${COVER_ALBUM}/photos/script.sh',
    ...    {method:'DELETE'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    400
