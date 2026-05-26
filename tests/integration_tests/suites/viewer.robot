*** Settings ***
Resource          ../resources/admin.resource
Suite Setup       Viewer Suite Setup
Suite Teardown    Viewer Suite Teardown

*** Variables ***
${VIEWER_ALBUM}    robot-viewer

*** Keywords ***
Viewer Suite Setup
    Login As Admin And Go To Admin
    Delete Album If Exists    ${VIEWER_ALBUM}
    Create Album              ${VIEWER_ALBUM}
    Upload Photos To Album    ${VIEWER_ALBUM}
    ...    ${FIXTURE_DIR}/test-photo-1.png
    ...    ${FIXTURE_DIR}/test-photo-2.png
    ...    ${FIXTURE_DIR}/test-photo-3.png
    Go To    ${BASE_URL}/viewer.html?album=${VIEWER_ALBUM}
    Wait For Elements State    css=#thumbnails .thumb >> nth=0    visible    timeout=10s

Viewer Suite Teardown
    Run Keyword And Ignore Error    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/${VIEWER_ALBUM}', {method:'DELETE'})
    Close Browser

*** Test Cases ***

Viewer Loads Thumbnails For Album
    ${count}=    Get Element Count    css=#thumbnails .thumb
    Should Be True    ${count} >= 3

First Thumbnail Is Active On Load
    ${count}=    Get Element Count    css=.thumb.active[data-i="0"]
    Should Be Equal As Integers    ${count}    1

Photo Name Is Displayed
    ${name}=    Get Text    id=photo-name
    Should Not Be Empty    ${name}

Views Counter Updates After Load
    Sleep    2s
    ${views}=    Get Text    id=photo-views
    Should Not Be Empty    ${views}

Clicking A Thumbnail Makes It Active
    Click    css=.thumb[data-i="2"]
    Wait For Elements State    css=.thumb.active[data-i="2"]    visible    timeout=5s

Arrow Right Key Navigates To Next Photo
    Click    css=.thumb[data-i="0"]
    Wait For Elements State    css=.thumb.active[data-i="0"]    visible    timeout=5s
    Keyboard Key    press    ArrowRight
    Wait For Elements State    css=.thumb.active[data-i="1"]    visible    timeout=5s

Arrow Left Key Navigates To Previous Photo
    Click    css=.thumb[data-i="1"]
    Wait For Elements State    css=.thumb.active[data-i="1"]    visible    timeout=5s
    Keyboard Key    press    ArrowLeft
    Wait For Elements State    css=.thumb.active[data-i="0"]    visible    timeout=5s

Download Button Is Accessible For Authenticated User
    Click    css=.thumb[data-i="0"]
    Wait For Elements State    css=.thumb.active[data-i="0"]    visible    timeout=5s
    # #photo-actions is hidden for anonymous users; admin should see it
    Wait For Elements State    id=photo-actions    visible    timeout=5s
    Click    id=photo-actions-toggle
    ${expanded}=    Get Attribute    id=photo-actions-toggle    aria-expanded
    Should Be Equal    ${expanded}    true
    ${href}=    Get Attribute    id=download-btn    href
    Should Not Be Empty    ${href}

Album Appears In Navigation Tabs
    ${count}=    Get Element Count    css=#album-tabs [role="tab"]
    Should Be True    ${count} >= 1
