*** Settings ***
Documentation     Users in the admin, through the interface: create with a generated or
...               typed password (the policy shown before sending), reveal, role,
...               password change (then a real sign-in with it), delete, the protected
...               admin account. The Generate buttons once did nothing for weeks while
...               the API tests stayed green: these click.
Resource          ../resources/ui.resource
Suite Setup       Login As Admin And Go To Admin
Suite Teardown    Clean Up

*** Variables ***
${U1}    ui-user-one
${U2}    ui-user-two

*** Keywords ***
Clean Up
    FOR    ${name}    IN    ${U1}    ${U2}
        ${id}=    User Id    ${name}
        IF    ${id}    Run Keyword And Ignore Error    Admin API    DELETE    /api/admin/users/${id}
    END
    Close Browser

Open New User Form
    Go To Admin Page
    Click    id=new-user-btn
    Wait For Elements State    id=new-user-form    visible

*** Test Cases ***
New User Form Opens And Cancels
    Open New User Form
    Click    id=new-user-cancel
    Wait For Elements State    id=new-user-form    hidden

Weak Password Is Refused Before Sending
    Open New User Form
    Fill Text    id=new-user-username    ${U1}
    Fill Text    id=new-user-password    weak
    Click    css=#new-user-form button[type="submit"]
    Get Text    id=new-user-pwd-error    !=    ${EMPTY}
    ${id}=    User Id    ${U1}
    Should Be Equal As Integers    ${id}    0

Each Policy Rule Is Explained
    [Template]    Typed Password Shows An Error
    abcdefgh
    ABCDEFGH1!
    abcdefgh1!
    Abcdefghi!
    Abcdefgh1

Generated Password Creates The User
    Open New User Form
    Fill Text    id=new-user-username    ${U1}
    Click    id=new-user-gen-btn
    Get Property    id=new-user-password    value    matches    ^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9]).{8,}
    Get Property    id=new-user-password    type    ==    text
    Click    css=#new-user-form button[type="submit"]
    Wait For Elements State    css=#users-body tr >> text=${U1}    visible    timeout=8s

Reveal Button Shows And Hides The Password
    Open New User Form
    Fill Text    id=new-user-password    Secret#123
    Get Property    id=new-user-password    type    ==    password
    Click    id=new-user-reveal-btn
    Get Property    id=new-user-password    type    ==    text
    Click    id=new-user-reveal-btn
    Get Property    id=new-user-password    type    ==    password
    Click    id=new-user-cancel

Duplicate Username Shows An Error
    Open New User Form
    Fill Text    id=new-user-username    ${U1}
    Click    id=new-user-gen-btn
    Get Property    id=new-user-password    value    !=    ${EMPTY}
    Handle Future Dialogs    action=accept
    Click    css=#new-user-form button[type="submit"]
    ${n}=    Get Element Count    css=#users-body tr >> text=${U1}
    Should Be Equal As Integers    ${n}    1

Role Select Changes The Role
    Go To Admin Page
    ${id}=    User Id    ${U1}
    Select Options By    css=.user-role-select[data-id="${id}"]    value    admin
    Wait Until Keyword Succeeds    10s    500ms    User Role Is    ${U1}    admin
    Select Options By    css=.user-role-select[data-id="${id}"]    value    basic
    Wait Until Keyword Succeeds    10s    500ms    User Role Is    ${U1}    basic

Change Password Window With Generate Then Sign In With It
    Go To Admin Page
    ${id}=    User Id    ${U1}
    Click    css=[data-pwd="${id}"]
    Wait For Elements State    id=pwd-overlay    visible
    Get Text    id=pwd-username    ==    ${U1}
    Click    id=pwd-gen-btn
    Get Property    id=pwd-new    value    matches    ^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9]).{8,}
    ${pwd}=    Get Property    id=pwd-new    value
    Click    id=pwd-save-btn
    Wait For Elements State    id=pwd-overlay    hidden    timeout=8s
    # a separate session signs in with the new password
    Open Page As    ${U1}    ${pwd}    /
    Get Text    css=.home-auth-user    contains    ${U1}
    Close Context

Change Password Window Refuses A Weak Password
    Go To Admin Page
    ${id}=    User Id    ${U1}
    Click    css=[data-pwd="${id}"]
    Wait For Elements State    id=pwd-overlay    visible
    Fill Text    id=pwd-new    short
    Click    id=pwd-save-btn
    Get Text    id=pwd-error    !=    ${EMPTY}
    Get Element States    id=pwd-overlay    contains    visible
    Click    id=pwd-close-btn

Escape Closes The Password Window
    Go To Admin Page
    ${id}=    User Id    ${U1}
    Click    css=[data-pwd="${id}"]
    Wait For Elements State    id=pwd-overlay    visible
    Keyboard Key    press    Escape
    Wait For Elements State    id=pwd-overlay    hidden

The Admin Account Cannot Be Deleted Or Demoted
    Go To Admin Page
    ${id}=    User Id    admin
    Get Element States    css=.user-role-select[data-id="${id}"]    contains    disabled
    Get Element States    css=[data-del="${id}"]    contains    disabled

Delete A User Through The Table
    Go To Admin Page
    ${id}=    User Id    ${U1}
    Handle Future Dialogs    action=accept
    Click    css=[data-del="${id}"]
    Wait For Elements State    css=#users-body tr >> text=${U1}    detached    timeout=8s
    ${id}=    User Id    ${U1}
    Should Be Equal As Integers    ${id}    0

Cancelled Confirmation Keeps The User
    Open New User Form
    Fill Text    id=new-user-username    ${U2}
    Click    id=new-user-gen-btn
    Get Property    id=new-user-password    value    !=    ${EMPTY}
    Click    css=#new-user-form button[type="submit"]
    Wait For Elements State    css=#users-body tr >> text=${U2}    visible    timeout=8s
    ${id}=    User Id    ${U2}
    Handle Future Dialogs    action=dismiss
    Click    css=[data-del="${id}"]
    Sleep    500ms
    Get Element Count    css=#users-body tr >> text=${U2}    ==    1

*** Keywords ***
Typed Password Shows An Error
    [Arguments]    ${password}
    Open New User Form
    Fill Text    id=new-user-username    ${U2}
    Fill Text    id=new-user-password    ${password}
    Click    css=#new-user-form button[type="submit"]
    Get Text    id=new-user-pwd-error    !=    ${EMPTY}
    Click    id=new-user-cancel

User Role Is
    [Arguments]    ${username}    ${role}
    ${r}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/admin/users').then((r) => r.json()).then((d) => (d.users.find((u) => u.username === '${username}') || {}).role)
    Should Be Equal    ${r}    ${role}
