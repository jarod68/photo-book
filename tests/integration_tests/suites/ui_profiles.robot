*** Settings ***
Documentation     Users and their albums: a user (made by the admin) creates an album on
...               "My albums" — theirs only —, makes it private (nobody else sees it, the
...               admin does, with its owner), writes in it; fills their profile (name,
...               bio) shown on a public page and on their album's card; changes their
...               password. They cannot touch another's album.
Resource          ../resources/ui.resource
Suite Setup       Prepare
Suite Teardown    Clean Up

*** Variables ***
${USER}        ui-ana
${PASS}        Voyage#2026ok
${NEW_PASS}    Lagune#2027ok
${ALBUM}       ui-ana-acores
${OTHER}       ui-prof-admin

*** Keywords ***
Prepare
    Login As Admin
    Delete Albums By API    ${ALBUM}    ${OTHER}
    Delete User By API    ${USER}
    ${s}=    Admin API    POST    /api/admin/users    {"username": "${USER}", "password": "${PASS}", "role": "basic"}
    Should Be Equal As Integers    ${s}    201
    Create Album By API    ${OTHER}
    ${admin_ctx}=    Get Context Ids    Active
    Set Suite Variable    ${ADMIN_CTX}    ${admin_ctx}[0]
    Open Page As    ${USER}    ${PASS}    /
    ${user_ctx}=    Get Context Ids    Active
    Set Suite Variable    ${USER_CTX}    ${user_ctx}[0]

Clean Up
    Run Keyword And Ignore Error    Switch Context    ${ADMIN_CTX}
    Delete Albums By API    ${ALBUM}    ${OTHER}
    Delete User By API    ${USER}
    Close Browser

Delete User By API
    [Arguments]    ${username}
    ${id}=    User Id    ${username}
    IF    ${id}    Admin API    DELETE    /api/admin/users/${id}

As Admin
    Switch Context    ${ADMIN_CTX}

As User
    Switch Context    ${USER_CTX}

*** Test Cases ***
A User Creates An Album On My Albums, And Sees Only Theirs
    As User
    Go To    ${BASE_URL}/admin.html
    Wait For Elements State    id=new-album-btn    visible    timeout=10s
    Get Text    css=h1.admin-title    ==    Mes albums
    Get Element Count    css=#section-users:not([hidden])    ==    0
    Create Album    ${ALBUM}
    ${n}=    Upload Generated Photos    /api/admin/albums/${ALBUM}/photos    2    ana
    Should Be Equal As Integers    ${n}    2
    Get Element Count    css=[data-album="${OTHER}"]    ==    0

They Cannot Touch Another's Album
    As User
    ${s}=    Admin API    GET    /api/admin/albums/${OTHER}/settings
    Should Be Equal As Integers    ${s}    403
    ${s}=    Admin API    PATCH    /api/admin/albums/${OTHER}    {"name": "stolen"}
    Should Be Equal As Integers    ${s}    403
    ${s}=    Admin API    POST    /api/admin/articles    {"album": "${OTHER}", "title": "Non"}
    Should Be Equal As Integers    ${s}    403

A Private Album Is Theirs Alone, And The Admin's
    As User
    Go To    ${BASE_URL}/admin.html
    Wait For Elements State    css=[data-settings="${ALBUM}"]    visible    timeout=10s
    Click    css=[data-settings="${ALBUM}"]
    Wait For Elements State    id=vis-private    visible    timeout=5s
    Get Element Count    css=#album-settings-owner[hidden]    ==    1
    Click    id=vis-private
    Click    id=album-settings-save-btn
    Wait For Elements State    css=[data-album="${ALBUM}"] .admin-visibility-badge--private    visible    timeout=8s
    # a visitor and another member see nothing of it
    New Context    locale=fr-FR
    New Page    ${BASE_URL}/
    Wait For Elements State    css=#album-grid    attached    timeout=8s
    ${names}=    Evaluate JavaScript    ${NONE}    () => fetch('/api/albums').then((r) => r.json()).then((a) => a.map((x) => x.name))
    Should Not Contain    ${names}    ${ALBUM}
    ${st}=    Evaluate JavaScript    ${NONE}    () => fetch('/api/albums/${ALBUM}').then((r) => r.status)
    Should Be Equal As Integers    ${st}    401
    Close Context
    # the admin does, with its owner
    As Admin
    Go To Admin Page
    Wait For Elements State    css=[data-album="${ALBUM}"]    visible    timeout=10s
    Get Text    css=[data-album="${ALBUM}"] .admin-album-meta    contains    @${USER}

The Owner Writes In Their Album From The Viewer
    As User
    Go To    ${BASE_URL}/viewer.html?album=${ALBUM}
    Wait For Elements State    id=photo-actions-toggle    visible    timeout=10s
    Click    id=photo-actions-toggle
    Click    id=new-article-btn
    Wait For Elements State    id=write-title    visible    timeout=10s
    Fill Text    id=write-title    Mon premier récit
    Check Checkbox    id=write-published
    Click    id=write-save
    Wait For Elements State    css=.write-status--saved    visible    timeout=8s

Their Profile: Name, Bio, A Public Page, Their Album Signed
    As User
    Go To    ${BASE_URL}/account.html
    Wait For Elements State    id=profile-name    visible    timeout=10s
    Fill Text    id=profile-name    Ana Silva
    Fill Text    id=profile-bio    Amoureuse des îles.
    Click    css=#profile-form button[type="submit"]
    Wait For Elements State    css=#profile-status.account-status--ok    visible    timeout=8s
    # public again, so that visitors see it
    ${s}=    Admin API    PUT    /api/admin/albums/${ALBUM}/settings    {"visibility": "public", "userIds": [], "notifyNew": true, "gpsPrivacy": "exact"}
    Should Be Equal As Integers    ${s}    200
    New Context    locale=fr-FR
    New Page    ${BASE_URL}/profile.html?u=${USER}
    Wait For Elements State    id=profile-head    visible    timeout=10s
    Get Text    id=profile-name    ==    Ana Silva
    Get Text    id=profile-bio    ==    Amoureuse des îles.
    Wait For Elements State    css=#profile-album-grid a.album-card[href*="${ALBUM}"]    visible    timeout=10s
    Get Text    css=#profile-article-grid    contains    Mon premier récit
    Go To    ${BASE_URL}/
    Wait For Elements State    css=#album-grid a.album-card[href*="${ALBUM}"]    visible    timeout=10s
    Get Text    css=#album-grid a.album-card[href*="${ALBUM}"] .album-card-by    ==    par Ana Silva
    Close Context

Their Password: The Current One First
    As User
    Go To    ${BASE_URL}/account.html
    Wait For Elements State    id=pw-current    visible    timeout=10s
    Fill Text    id=pw-current    wrong-password
    Fill Text    id=pw-new    ${NEW_PASS}
    Fill Text    id=pw-confirm    ${NEW_PASS}
    Click    css=#password-form button[type="submit"]
    Wait For Elements State    css=#password-status.account-status--error    visible    timeout=8s
    Fill Text    id=pw-current    ${PASS}
    Fill Text    id=pw-new    ${NEW_PASS}
    Fill Text    id=pw-confirm    ${NEW_PASS}
    Click    css=#password-form button[type="submit"]
    Wait For Elements State    css=#password-status.account-status--ok    visible    timeout=8s
    # the new one signs in
    Open Page As    ${USER}    ${NEW_PASS}    /account.html
    Wait For Elements State    id=profile-name    visible    timeout=10s
    Close Context
