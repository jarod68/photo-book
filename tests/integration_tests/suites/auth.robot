*** Settings ***
Resource          ../resources/auth.resource
Test Teardown     Close Browser

*** Test Cases ***

Admin Login With Valid Credentials Succeeds
    Open Login Page
    Submit Login Form    ${ADMIN_USER}    ${ADMIN_PASS}
    Wait For Elements State    css=body.page-home    visible    timeout=12s
    Wait For Elements State    css=#home-auth .home-auth-user    visible    timeout=5s

Admin Login Redirects To Home Page
    Open Login Page
    Submit Login Form    ${ADMIN_USER}    ${ADMIN_PASS}
    Wait For Elements State    css=body.page-home    visible    timeout=12s
    Get Title    ==    Photo Book

Already Logged In User Is Redirected Away From Login
    Login As Admin
    New Page    ${BASE_URL}/login.html
    Wait For Elements State    css=body.page-home    visible    timeout=5s

Login With Wrong Password Shows Error
    Open Login Page
    Submit Login Form    ${ADMIN_USER}    wrong-password
    Login Error Should Be Visible

Login With Unknown Username Shows Error
    Open Login Page
    Submit Login Form    nobody    wrong-password
    Login Error Should Be Visible

Login Error Does Not Reveal Whether User Exists
    Open Login Page
    Submit Login Form    nobody    wrong
    Wait For Elements State    id=login-error    visible    timeout=4s
    ${err_unknown}=    Get Text    id=login-error
    Go To    ${BASE_URL}/login.html
    Submit Login Form    ${ADMIN_USER}    wrong
    Wait For Elements State    id=login-error    visible    timeout=4s
    ${err_wrong_pwd}=    Get Text    id=login-error
    Should Be Equal    ${err_unknown}    ${err_wrong_pwd}

Basic User Login With Valid Credentials Succeeds
    Open Login Page
    Submit Login Form    ${BASIC_USER}    ${BASIC_PASS}
    Wait For Elements State    css=body.page-home    visible    timeout=12s
    Wait For Elements State    css=#home-auth .home-auth-user    visible    timeout=5s

Basic User Login Does Not Show Admin Button
    Open Login Page
    Submit Login Form    ${BASIC_USER}    ${BASIC_PASS}
    Wait For Elements State    css=#home-auth    visible    timeout=5s
    ${count}=    Get Element Count    css=a[href="/admin.html"]
    Should Be Equal As Integers    ${count}    0

Admin Login Shows Admin Button
    Login As Admin
    Wait For Elements State    css=a[href="/admin.html"]    visible    timeout=5s

Logout Clears Session And Returns To Home
    Login As Admin
    Logout
    Wait For Elements State    css=a[href="/login.html"]    visible    timeout=5s

After Logout Session Cookie Is Cleared
    Login As Admin
    Logout
    Go To    ${BASE_URL}/login.html
    Wait For Elements State    id=login-form    visible    timeout=5s
