*** Settings ***
Documentation     Two-factor sign-in through the interface: a user sets it up on My account
...               (the key shown, a code computed here as an authenticator app would), gets
...               backup codes, then signs in with password + code; a wrong code is refused;
...               a backup code works once. Five wrong passwords lock the account; the
...               admin sees it and unlocks it. No Google button without its configuration.
Resource          ../resources/ui.resource
Suite Setup       Prepare
Suite Teardown    Clean Up

*** Variables ***
${USER}     ui-sec
${PASS}     Voyage#2026ok

*** Keywords ***
Prepare
    Login As Admin
    Delete User By API    ${USER}
    ${s}=    Admin API    POST    /api/admin/users    {"username": "${USER}", "password": "${PASS}", "role": "basic", "email": "${USER}@example.org"}
    Should Be Equal As Integers    ${s}    201
    ${ctx}=    Get Context Ids    Active
    Set Suite Variable    ${ADMIN_CTX}    ${ctx}[0]

Clean Up
    Run Keyword And Ignore Error    Switch Context    ${ADMIN_CTX}
    Delete User By API    ${USER}
    Close Browser

Delete User By API
    [Arguments]    ${username}
    ${id}=    User Id    ${username}
    IF    ${id}    Admin API    DELETE    /api/admin/users/${id}

TOTP Code
    [Documentation]    The current code for a base32 secret (RFC 6238, as an authenticator app)
    [Arguments]    ${secret}
    ${code}=    Evaluate JavaScript    ${NONE}
    ...    async () => {
    ...      const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', s = '${secret}'.replace(/\\s/g, '');
    ...      let bits = 0, v = 0; const key = [];
    ...      for (const c of s) { v = (v << 5) | B.indexOf(c); bits += 5; if (bits >= 8) { key.push((v >>> (bits - 8)) & 255); bits -= 8; } }
    ...      const counter = new ArrayBuffer(8); new DataView(counter).setUint32(4, Math.floor(Date.now() / 30000));
    ...      const k = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    ...      const h = new Uint8Array(await crypto.subtle.sign('HMAC', k, counter));
    ...      const o = h[19] & 15;
    ...      const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    ...      return String(n % 1000000).padStart(6, '0');
    ...    }
    RETURN    ${code}

Sign In
    [Arguments]    ${username}    ${password}
    New Context    locale=fr-FR
    New Page    ${BASE_URL}/login.html
    Submit Login Form    ${username}    ${password}

*** Test Cases ***
No Google Button Without Its Configuration
    New Context    locale=fr-FR
    New Page    ${BASE_URL}/login.html
    Wait For Elements State    id=login-form    visible    timeout=8s
    Get Element Count    css=#login-sso:not([hidden])    ==    0
    Close Context

A User Sets Up Two-Factor Sign-In
    Open Page As    ${USER}    ${PASS}    /account.html
    Wait For Elements State    id=sec-setup    visible    timeout=10s
    Get Text    id=sec-google    contains    ${USER}@example.org
    Click    id=sec-setup
    Wait For Elements State    css=#sec-qr svg    visible    timeout=8s
    ${secret}=    Get Text    id=sec-secret
    Set Suite Variable    ${SECRET}    ${secret}
    # a wrong code first
    Fill Text    id=sec-code    000000
    Click    css=#sec-setup-form button[type="submit"]
    Wait For Elements State    css=#sec-status.account-status--error    visible    timeout=5s
    ${code}=    TOTP Code    ${secret}
    Fill Text    id=sec-code    ${code}
    Click    css=#sec-setup-form button[type="submit"]
    Wait For Elements State    id=sec-backup    visible    timeout=8s
    Get Element Count    css=#sec-backup-codes li    ==    10
    ${backup}=    Get Text    css=#sec-backup-codes li >> nth=0
    Set Suite Variable    ${BACKUP}    ${backup}
    Get Text    id=sec-mfa-state    ==    Activée
    Close Context

Sign In Asks For The Code
    Sign In    ${USER}    ${PASS}
    Wait For Elements State    id=code-form    visible    timeout=8s
    Fill Text    id=code    111111
    Click    css=#code-form button[type="submit"]
    Wait For Elements State    id=code-error    visible    timeout=5s
    # the app's next code (the one of the setup was used): wait for a fresh step
    Sleep    31s
    ${code}=    TOTP Code    ${SECRET}
    Fill Text    id=code    ${code}
    Click    css=#code-form button[type="submit"]
    Wait For Elements State    css=body.page-home    visible    timeout=10s
    Close Context

A Backup Code Works Once
    Sign In    ${USER}    ${PASS}
    Wait For Elements State    id=code-form    visible    timeout=8s
    Fill Text    id=code    ${BACKUP}
    Click    css=#code-form button[type="submit"]
    Wait For Elements State    css=body.page-home    visible    timeout=10s
    Close Context
    Sign In    ${USER}    ${PASS}
    Wait For Elements State    id=code-form    visible    timeout=8s
    Fill Text    id=code    ${BACKUP}
    Click    css=#code-form button[type="submit"]
    Wait For Elements State    id=code-error    visible    timeout=5s
    Close Context

Five Wrong Passwords Lock The Account, The Admin Unlocks It
    FOR    ${i}    IN RANGE    5
        ${s}=    Evaluate JavaScript    ${NONE}
        ...    () => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: '${USER}', password: 'wrong' }) }).then((r) => r.status)
        Should Be Equal As Integers    ${s}    401
    END
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: '${USER}', password: '${PASS}' }) }).then((r) => r.status)
    Should Be Equal As Integers    ${s}    401
    Switch Context    ${ADMIN_CTX}
    Go To    ${BASE_URL}/admin.html
    Wait For Elements State    css=tr[data-user-id] a.admin-link >> text=${USER}    visible    timeout=10s
    ${id}=    User Id    ${USER}
    Wait For Elements State    css=[data-unlock="${id}"]    visible    timeout=8s
    Click    css=[data-unlock="${id}"]
    Wait For Elements State    css=[data-unlock="${id}"]    detached    timeout=8s
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: '${USER}', password: '${PASS}' }) }).then((r) => r.json()).then((b) => String(!!b.mfa))
    Should Be Equal    ${s}    true
