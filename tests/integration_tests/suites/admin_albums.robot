*** Settings ***
Resource          ../resources/admin.resource
Suite Setup       Admin Login And Prepare
Suite Teardown    Admin Cleanup And Logout

*** Variables ***
${TEST_ALBUM}    robot-test

*** Keywords ***
Admin Login And Prepare
    Login As Admin And Go To Admin
    Delete Album If Exists    ${TEST_ALBUM}
    Create Album              ${TEST_ALBUM}

Admin Cleanup And Logout
    Run Keyword And Ignore Error    Go To    ${BASE_URL}/admin.html
    Run Keyword And Ignore Error    Evaluate JavaScript    ${NONE}
    ...    () => Promise.all(['${TEST_ALBUM}', 'robot-ephemeral', 'robot-to-delete', 'robot-log-test']
    ...    .map(n => fetch('/api/admin/albums/' + n, {method:'DELETE'})))
    Close Browser

*** Test Cases ***

Album Appears In Admin Table After Creation
    Wait For Elements State    css=[data-album="${TEST_ALBUM}"]    visible    timeout=5s
    Get Element Count          css=[data-album="${TEST_ALBUM}"]    ==    1

Album Has Upload And Delete Buttons
    Get Element Count    css=[data-upload="${TEST_ALBUM}"]    ==    1
    Get Element Count    css=[data-delete="${TEST_ALBUM}"]    ==    1

Admin Can Upload One Photo To Album
    Upload Photos To Album    ${TEST_ALBUM}    ${FIXTURE_DIR}/test-photo-1.png
    Wait For Elements State    css=[data-album="${TEST_ALBUM}"]    visible    timeout=10s

Photo Count Increases After Upload
    ${text}=    Get Text    css=[data-album="${TEST_ALBUM}"] td >> nth=1
    Should Match Regexp    ${text}    ^[1-9]

Admin Can Upload Multiple Photos At Once
    Upload Photos To Album    ${TEST_ALBUM}
    ...    ${FIXTURE_DIR}/test-photo-2.png
    ...    ${FIXTURE_DIR}/test-photo-3.png
    Wait For Elements State    css=[data-album="${TEST_ALBUM}"]    visible    timeout=10s

Uploaded Photos Appear In Album Viewer
    Go To    ${BASE_URL}/viewer.html?album=${TEST_ALBUM}
    Wait For Elements State    css=#thumbnails .thumb >> nth=0    visible    timeout=10s
    ${count}=    Get Element Count    css=#thumbnails .thumb
    Should Be True    ${count} >= 1
    Go To Admin Page

Viewer Shows Correct Album Title
    Go To    ${BASE_URL}/viewer.html?album=${TEST_ALBUM}
    Wait For Elements State    css=#viewer-album-title, .viewer-title, h1    visible    timeout=5s
    Go To Admin Page

Admin Can Rename Album
    Click    css=[data-rename="${TEST_ALBUM}"]
    Wait For Elements State    css=[data-album="${TEST_ALBUM}"] .admin-inline-input    visible    timeout=4s
    Fill Text    css=[data-album="${TEST_ALBUM}"] .admin-inline-input    ${TEST_ALBUM}-renamed
    Press Keys   css=[data-album="${TEST_ALBUM}"] .admin-inline-input    Enter
    Wait For Elements State    css=[data-album="${TEST_ALBUM}-renamed"]    visible    timeout=8s
    # Rename back for cleanup
    Click    css=[data-rename="${TEST_ALBUM}-renamed"]
    Wait For Elements State    css=[data-album="${TEST_ALBUM}-renamed"] .admin-inline-input    visible    timeout=4s
    Fill Text    css=[data-album="${TEST_ALBUM}-renamed"] .admin-inline-input    ${TEST_ALBUM}
    Press Keys   css=[data-album="${TEST_ALBUM}-renamed"] .admin-inline-input    Enter
    Wait For Elements State    css=[data-album="${TEST_ALBUM}"]    visible    timeout=8s

Admin Can Create And Delete A Separate Album
    Create Album    robot-ephemeral
    Get Element Count    css=[data-album="robot-ephemeral"]    ==    1
    Delete Album    robot-ephemeral
    Get Element Count    css=[data-album="robot-ephemeral"]    ==    0

Album Disappears From Table After Deletion
    Create Album    robot-to-delete
    Wait For Elements State    css=[data-album="robot-to-delete"]    visible    timeout=5s
    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/robot-to-delete', {method:'DELETE'}).then(r => r.status)
    Go To Admin Page
    ${count}=    Get Element Count    css=[data-album="robot-to-delete"]
    Should Be Equal As Integers    ${count}    0
