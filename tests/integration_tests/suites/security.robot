*** Settings ***
Resource          ../resources/admin.resource
Test Teardown     Close Browser

*** Variables ***
${API_STATS}        /api/admin/stats
${API_ALBUMS}       /api/admin/albums
${API_USERS}        /api/admin/users
${API_LOGS}         /api/admin/logs
${NEW_ALBUM_JSON}   {"name":"robot-sec-album"}
${NEW_USER_JSON}    {"username":"robot-sec-user","password":"Robot@sec1","role":"basic"}

# ── Unauthenticated ────────────────────────────────────────────────────────────

*** Test Cases ***

Unauth Admin Stats Returns 401
    [Tags]    unauth
    New Browser    ${BROWSER}    headless=${HEADLESS}
    New Context    locale=fr-FR
    New Page       ${BASE_URL}
    ${s}=    Evaluate JavaScript    ${NONE}    () => fetch('${API_STATS}').then(r => r.status)
    Should Be Equal As Integers    ${s}    401

Unauth Create Album Returns 401
    [Tags]    unauth
    New Browser    ${BROWSER}    headless=${HEADLESS}
    New Context    locale=fr-FR
    New Page       ${BASE_URL}
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('${API_ALBUMS}', {method:'POST',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:'${NEW_ALBUM_JSON}'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    401

Unauth Create User Returns 401
    [Tags]    unauth
    New Browser    ${BROWSER}    headless=${HEADLESS}
    New Context    locale=fr-FR
    New Page       ${BASE_URL}
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('${API_USERS}', {method:'POST',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:'${NEW_USER_JSON}'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    401

Unauth Upload Photo Returns 401
    [Tags]    unauth
    New Browser    ${BROWSER}    headless=${HEADLESS}
    New Context    locale=fr-FR
    New Page       ${BASE_URL}
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/any/photos',
    ...    {method:'POST', body: new FormData()}).then(r => r.status)
    Should Be Equal As Integers    ${s}    401

Unauth Delete Album Returns 401
    [Tags]    unauth
    New Browser    ${BROWSER}    headless=${HEADLESS}
    New Context    locale=fr-FR
    New Page       ${BASE_URL}
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('${API_ALBUMS}/any', {method:'DELETE'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    401

Unauth Logs Returns 401
    [Tags]    unauth
    New Browser    ${BROWSER}    headless=${HEADLESS}
    New Context    locale=fr-FR
    New Page       ${BASE_URL}
    ${s}=    Evaluate JavaScript    ${NONE}    () => fetch('${API_LOGS}').then(r => r.status)
    Should Be Equal As Integers    ${s}    401

# ── Basic user ─────────────────────────────────────────────────────────────────

Basic User Stats Returns 403
    [Tags]    basic
    Login As Basic
    ${s}=    Evaluate JavaScript    ${NONE}    () => fetch('${API_STATS}').then(r => r.status)
    Should Be Equal As Integers    ${s}    403

Basic User Create Album Returns 403
    [Tags]    basic
    Login As Basic
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('${API_ALBUMS}', {method:'POST',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:'${NEW_ALBUM_JSON}'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    403

Basic User Create User Returns 403
    [Tags]    basic
    Login As Basic
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('${API_USERS}', {method:'POST',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:'${NEW_USER_JSON}'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    403

Basic User Upload Photo Returns 403
    [Tags]    basic
    Login As Basic
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/albums/any/photos',
    ...    {method:'POST', body: new FormData()}).then(r => r.status)
    Should Be Equal As Integers    ${s}    403

Basic User Delete Album Returns 403
    [Tags]    basic
    Login As Basic
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('${API_ALBUMS}/any', {method:'DELETE'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    403

Basic User Cannot See Admin Sections On Admin Page
    [Tags]    basic
    Login As Basic
    Go To    ${BASE_URL}/admin.html
    Wait For Elements State    id=section-albums    attached    timeout=5s
    ${albums_hidden}=    Evaluate JavaScript    ${NONE}    () => document.getElementById('section-albums').hidden
    ${users_hidden}=     Evaluate JavaScript    ${NONE}    () => document.getElementById('section-users').hidden
    ${system_hidden}=    Evaluate JavaScript    ${NONE}    () => document.getElementById('section-system').hidden
    Should Be True    ${albums_hidden}
    Should Be True    ${users_hidden}
    Should Be True    ${system_hidden}

# ── Admin ──────────────────────────────────────────────────────────────────────

Admin Stats Returns 200
    [Tags]    admin
    Login As Admin And Go To Admin
    ${s}=    Evaluate JavaScript    ${NONE}    () => fetch('${API_STATS}').then(r => r.status)
    Should Be Equal As Integers    ${s}    200

Admin Can List Users
    [Tags]    admin
    Login As Admin And Go To Admin
    ${s}=    Evaluate JavaScript    ${NONE}    () => fetch('${API_USERS}').then(r => r.status)
    Should Be Equal As Integers    ${s}    200

Admin Can See All Sections On Admin Page
    [Tags]    admin
    Login As Admin And Go To Admin
    ${albums_hidden}=    Evaluate JavaScript    ${NONE}    () => document.getElementById('section-albums').hidden
    ${users_hidden}=     Evaluate JavaScript    ${NONE}    () => document.getElementById('section-users').hidden
    Should Be True    not ${albums_hidden}
    Should Be True    not ${users_hidden}

Admin User Cannot Be Deleted
    [Tags]    admin
    Login As Admin And Go To Admin
    ${admin_id}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('${API_USERS}').then(r => r.json())
    ...    .then(d => d.users.find(u => u.username === 'admin')?.id)
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('${API_USERS}/${admin_id}', {method:'DELETE'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    403

Admin Can Create And Delete A User
    [Tags]    admin
    Login As Admin And Go To Admin
    ${s_create}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('${API_USERS}', {method:'POST',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:'{"username":"robot-tmp","password":"Robot@tmp1","role":"basic"}'})
    ...    .then(r => r.status)
    Should Be Equal As Integers    ${s_create}    201
    ${uid}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('${API_USERS}').then(r => r.json())
    ...    .then(d => d.users.find(u => u.username === 'robot-tmp')?.id)
    ${s_del}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('${API_USERS}/${uid}', {method:'DELETE'}).then(r => r.status)
    Should Be Equal As Integers    ${s_del}    200

Activity Log Records Album Creation
    [Tags]    admin
    Login As Admin And Go To Admin
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('${API_ALBUMS}', {method:'POST',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:'{"name":"robot-log-test"}'}).then(r => r.status)
    Should Be Equal As Integers    ${s}    201
    Sleep    0.5s
    ${found}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('${API_LOGS}?action=album_create').then(r => r.json())
    ...    .then(d => !!(d.logs || []).find(l => l.details && l.details.album === 'robot-log-test'))
    Should Be True    ${found}
    Evaluate JavaScript    ${NONE}
    ...    () => fetch('${API_ALBUMS}/robot-log-test', {method:'DELETE'})
