*** Settings ***
Resource          ../resources/admin.resource
Suite Setup       Viewer Edge Cases Setup
Suite Teardown    Viewer Edge Cases Teardown

*** Variables ***
${EMPTY_ALBUM}    robot-edge-empty
${ANON_ALBUM}     robot-edge-anon

*** Keywords ***
Viewer Edge Cases Setup
    Login As Admin And Go To Admin
    Delete Album If Exists    ${EMPTY_ALBUM}
    Delete Album If Exists    ${ANON_ALBUM}
    Create Album    ${EMPTY_ALBUM}
    Create Album    ${ANON_ALBUM}
    Upload Photos To Album    ${ANON_ALBUM}
    ...    ${FIXTURE_DIR}/test-photo-1.png

Viewer Edge Cases Teardown
    Run Keyword And Ignore Error    Evaluate JavaScript    ${NONE}
    ...    () => Promise.all(['${EMPTY_ALBUM}', '${ANON_ALBUM}']
    ...    .map(n => fetch('/api/admin/albums/' + n, {method:'DELETE'})))
    Close Browser

*** Test Cases ***

Empty Album API Returns Empty Photos Array
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${EMPTY_ALBUM}').then(r => r.json())
    Length Should Be    ${data}[photos]    0

Empty Album Viewer Has No Thumbnails
    Go To    ${BASE_URL}/viewer.html?album=${EMPTY_ALBUM}
    Sleep    2s
    ${count}=    Get Element Count    css=#thumbnails .thumb
    Should Be Equal As Integers    ${count}    0

GET Non-Existent Album Returns 404
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/this-album-does-not-exist-xyz').then(r => r.status)
    Should Be Equal As Integers    ${s}    404

GET Album Returns canDownload False For Anonymous
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${ANON_ALBUM}', {credentials:'omit'}).then(r => r.json())
    Should Not Be True    ${data}[canDownload]

GET Album Returns canDownload True For Authenticated Admin
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${ANON_ALBUM}').then(r => r.json())
    Should Be True    ${data}[canDownload]

GET Album Photos Include Filename And URL
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums/${ANON_ALBUM}').then(r => r.json())
    ...    .then(d => d.photos.every(p => p.filename && p.url))
    Should Be True    ${data}

Anonymous Viewer Does Not Show Download Actions
    New Context    locale=fr-FR
    New Page    ${BASE_URL}/viewer.html?album=${ANON_ALBUM}
    Wait For Elements State    css=#thumbnails .thumb >> nth=0    visible    timeout=10s
    Wait For Elements State    id=photo-actions    hidden    timeout=5s
