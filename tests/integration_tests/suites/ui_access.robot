*** Settings ***
Documentation     Rights as each person sees them: a member authorized on a restricted
...               album may add (menu, drop on the photo, drop on its card) and delete
...               there; on an album he is not authorized on he sees nothing; on a
...               public album, a member reads but does not change. Signing in comes
...               back to the page that asked for it.
Resource          ../resources/ui.resource
Suite Setup       Prepare
Suite Teardown    Clean Up

*** Variables ***
${MINE}      ui-access-mine
${OTHER}     ui-access-other
${PUBLIC}    ui-access-public

*** Keywords ***
Prepare
    Login As Admin
    Create Album By API    ${MINE}
    Create Album By API    ${OTHER}
    Create Album By API    ${PUBLIC}
    Upload Generated Photos As Admin    ${MINE}      1    mine
    Upload Generated Photos As Admin    ${OTHER}     1    other
    Upload Generated Photos As Admin    ${PUBLIC}    1    pub
    ${basic}=    User Id    ${BASIC_USER}
    Make Album Restricted For    ${MINE}    ${basic}
    Make Album Restricted For    ${OTHER}
    ${admin_ctx}=    Get Context Ids    Active
    Set Suite Variable    ${ADMIN_CTX}    ${admin_ctx}[0]
    # the member's own browser
    Open Page As    ${BASIC_USER}    ${BASIC_PASS}    /
    ${member_ctx}=    Get Context Ids    Active
    Set Suite Variable    ${MEMBER_CTX}    ${member_ctx}[0]

Clean Up
    Run Keyword And Ignore Error    Switch Context    ${ADMIN_CTX}
    Delete Albums By API    ${MINE}    ${OTHER}    ${PUBLIC}
    Close Browser

As Member
    Switch Context    ${MEMBER_CTX}

Member Opens
    [Arguments]    ${album}
    As Member
    Go To    ${BASE_URL}/viewer.html?album=${album}
    Wait For Elements State    css=#thumbnails .thumb >> nth=0    visible    timeout=10s

*** Test Cases ***
Member Sees The Album He Is Authorized On, Not The Other
    As Member
    Go To    ${BASE_URL}/
    Wait For Elements State    css=#album-grid a.album-card >> nth=0    visible    timeout=10s
    Get Element Count    css=a.album-card[href*="${MINE}"]    ==    1
    Get Element Count    css=a.album-card[href*="${OTHER}"]    ==    0

Member Has No Admin Link
    As Member
    Go To    ${BASE_URL}/
    Wait For Elements State    css=#album-grid a.album-card >> nth=0    visible    timeout=10s
    Get Element Count    css=a[href="/admin.html"]    ==    0

Member Menu Offers Add And Delete On His Album
    Member Opens    ${MINE}
    Click    id=photo-actions-toggle
    Wait For Elements State    id=upload-btn    visible
    Wait For Elements State    id=delete-btn    visible
    Keyboard Key    press    Escape

Member Adds A Photo From The Menu
    Member Opens    ${MINE}
    Click    id=photo-actions-toggle
    Click    id=upload-btn
    Upload File By Selector    id=upload-file-input    ${FIXTURE_DIR}/test-photo-2.png
    Click    id=upload-start-btn
    Wait For Elements State    id=upload-overlay    hidden    timeout=30s
    Get Element Count    css=#thumbnails .thumb    ==    2

Member Drops A Photo On The Viewer
    Member Opens    ${MINE}
    Drop Generated Photos On    id=viewer    1    memberdrop
    Wait For Elements State    id=upload-overlay    hidden    timeout=30s
    Get Element Count    css=#thumbnails .thumb    ==    3

Member Drops A Photo On His Album Card
    As Member
    Go To    ${BASE_URL}/
    Wait For Elements State    css=a.album-card[href*="${MINE}"]    visible    timeout=10s
    Drop Generated Photos On    css=a.album-card[href*="${MINE}"]    1    membercard
    Wait For Elements State    id=upload-overlay    hidden    timeout=30s
    ${n}=    Album Photo Count    ${MINE}
    Should Be Equal As Integers    ${n}    4

Member Deletes A Photo On His Album
    Member Opens    ${MINE}
    Handle Future Dialogs    action=accept
    Click    id=photo-actions-toggle
    Click    id=delete-btn
    Get Element Count    css=#thumbnails .thumb    ==    3

Member Reads A Public Album Without Changing It
    Member Opens    ${PUBLIC}
    Get Element States    id=upload-btn    contains    hidden
    Get Element States    id=delete-btn    contains    hidden
    Drop Generated Photos On    id=viewer    1    nope
    Get Element Count    css=#upload-overlay:not([hidden])    ==    0

Member Upload Is Refused By The Server Where He Has No Right
    As Member
    ${public}=    Upload Generated Photos    /api/albums/${PUBLIC}/photos    1    x
    Should Be Equal As Integers    ${public}    -403
    ${other}=    Upload Generated Photos    /api/albums/${OTHER}/photos    1    x
    Should Be Equal As Integers    ${other}    -403
    ${admin}=    Upload Generated Photos    /api/admin/albums/${MINE}/photos    1    x
    Should Be Equal As Integers    ${admin}    -403

Visitor Upload Is Refused
    Open Page Anonymously    /
    ${n}=    Upload Generated Photos    /api/albums/${PUBLIC}/photos    1    x
    Should Be Equal As Integers    ${n}    -401
    Close Context

The Admin Page Sends To Sign In, Then Back
    Open Page Anonymously    /admin.html
    Wait For Elements State    id=login-form    visible    timeout=10s
    Submit Login Form    ${ADMIN_USER}    ${ADMIN_PASS}
    Wait For Elements State    id=new-album-btn    visible    timeout=12s
    Wait For Url Contains    admin.html
    Close Context

Sign In From The Home Page Comes Back Home
    Open Page Anonymously    /
    Wait For Elements State    css=.home-auth-btn--login    visible    timeout=10s
    Click    css=.home-auth-btn--login
    Wait For Elements State    id=login-form    visible
    Click    css=.login-back
    Wait For Elements State    css=body.page-home    visible    timeout=10s
    Close Context
