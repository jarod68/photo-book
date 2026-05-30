*** Settings ***
Resource          ../resources/admin.resource
Suite Setup       Home Auth Suite Setup
Suite Teardown    Home Auth Suite Teardown

*** Variables ***
${AUTH_ALBUM}    robot-home-auth

*** Keywords ***
Home Auth Suite Setup
    Login As Admin
    Go To Admin Page
    Delete Album If Exists    ${AUTH_ALBUM}
    Create Album    ${AUTH_ALBUM}
    Go To    ${BASE_URL}
    Wait For Elements State    css=#album-grid    visible    timeout=8s

Home Auth Suite Teardown
    Run Keyword And Ignore Error    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/${AUTH_ALBUM}', {method:'DELETE'})
    Close Browser

*** Test Cases ***

Logged In User Sees Their Username In Auth Area
    ${text}=    Get Text    css=.home-auth-user
    Should Contain    ${text}    ${ADMIN_USER}

Admin Sees Link To Admin Panel
    ${count}=    Get Element Count    css=a[href="/admin.html"]
    Should Be Equal As Integers    ${count}    1

Admin Sees Logout Button
    ${count}=    Get Element Count    id=home-logout-btn
    Should Be Equal As Integers    ${count}    1

Album Cards Are Present Including Dedicated Album
    ${count}=    Get Element Count    css=#album-grid a.album-card
    Should Be True    ${count} >= 3

User Album Card Links To Viewer
    ${href}=    Get Attribute    css=#album-grid a.album-card:not([href="map.html"]):not([href="globe.html"]) >> nth=0    href
    Should Contain    ${href}    viewer.html

Summary Shows Album And Photo Counts
    ${text}=    Get Text    css=#summary
    Should Not Be Empty    ${text}
    Should Match Regexp    ${text}    \\d+

Logout Navigates To Home And Shows Sign In Link
    Click    id=home-logout-btn
    Wait For Elements State    css=a[href="/login.html"]    visible    timeout=8s
    ${count}=    Get Element Count    css=a[href="/login.html"]
    Should Be True    ${count} >= 1
