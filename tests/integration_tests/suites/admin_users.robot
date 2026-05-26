*** Settings ***
Resource          ../resources/admin.resource
Suite Setup       Login As Admin And Go To Admin
Suite Teardown    Users Suite Teardown

*** Variables ***
${TEST_USER}    robot-users-test
${TEST_PASS}    Robot@users1
${TEST_ID}      ${EMPTY}

*** Keywords ***
Users Suite Teardown
    Run Keyword And Ignore Error    Evaluate JavaScript    ${NONE}
    ...    async () => {
    ...    const d = await fetch('/api/admin/users').then(r => r.json());
    ...    const u = d.users.find(u => u.username === '${TEST_USER}');
    ...    if (u) await fetch('/api/admin/users/' + u.id, {method:'DELETE'});
    ...    }
    Close Browser

*** Test Cases ***

Users Table Renders Rows
    Wait For Elements State    id=users-body    visible    timeout=5s
    ${count}=    Get Element Count    css=#users-body tr
    Should Be True    ${count} >= 1

GET Generate Password Returns A Password
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/users/generate-password').then(r => r.json())
    Should Not Be Empty    ${data}[password]
    Should Match Regexp    ${data}[password]    ^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9]).{8,}

POST User With Weak Password Returns 400
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/users', {method:'POST',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:JSON.stringify({username:'robot-weak', password:'weak', role:'basic'})})
    ...    .then(r => r.status)
    Should Be Equal As Integers    ${s}    400

POST User With Duplicate Username Returns 409
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/users', {method:'POST',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:JSON.stringify({username:'${ADMIN_USER}', password:'${TEST_PASS}', role:'basic'})})
    ...    .then(r => r.status)
    Should Be Equal As Integers    ${s}    409

POST Create User Returns 201 And User Data
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/users', {method:'POST',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:JSON.stringify({username:'${TEST_USER}', password:'${TEST_PASS}', role:'basic'})})
    ...    .then(r => r.json())
    Should Be Equal    ${data}[user][role]    basic
    Should Be Equal    ${data}[user][username]    ${TEST_USER}
    Set Suite Variable    ${TEST_ID}    ${data}[user][id]

Created User Appears In Users Table
    Go To Admin Page
    Wait For Elements State    css=[data-user-id="${TEST_ID}"]    visible    timeout=8s

PATCH User Role Updates The Role
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/users/${TEST_ID}', {method:'PATCH',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:JSON.stringify({role:'admin'})}).then(r => r.status)
    Should Be Equal As Integers    ${s}    200
    ${role}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/users').then(r => r.json())
    ...    .then(d => d.users.find(u => u.id === ${TEST_ID}).role)
    Should Be Equal    ${role}    admin

PATCH Admin User Role Returns 403
    ${admin_id}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/users').then(r => r.json())
    ...    .then(d => d.users.find(u => u.username === '${ADMIN_USER}').id)
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/users/${admin_id}', {method:'PATCH',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:JSON.stringify({role:'basic'})}).then(r => r.status)
    Should Be Equal As Integers    ${s}    403

PATCH User Password Returns 200
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/users/${TEST_ID}', {method:'PATCH',
    ...    headers:{'Content-Type':'application/json'},
    ...    body:JSON.stringify({password:'Robot@changed9'})}).then(r => r.status)
    Should Be Equal As Integers    ${s}    200
