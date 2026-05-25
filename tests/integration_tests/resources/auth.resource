*** Settings ***
Resource    common.resource

*** Keywords ***
Open Login Page
    New Browser    ${BROWSER}    headless=${HEADLESS}
    New Context    locale=fr-FR
    New Page       ${BASE_URL}/login.html

Submit Login Form
    [Arguments]    ${username}    ${password}
    Fill Text    id=username    ${username}
    Fill Text    id=password    ${password}
    Click        css=button[type="submit"]

Login As
    [Arguments]    ${username}    ${password}
    Open Login Page
    Submit Login Form    ${username}    ${password}
    # body.page-home is a static class set in index.html — visible immediately on navigation
    Wait For Elements State    css=body.page-home    visible    timeout=12s

Login As Admin
    Login As    ${ADMIN_USER}    ${ADMIN_PASS}

Login As Basic
    Login As    ${BASIC_USER}    ${BASIC_PASS}

Logout
    Click    id=home-logout-btn
    Wait For Elements State    css=a[href="/login.html"]    visible    timeout=5s

Login Error Should Be Visible
    Wait For Elements State    id=login-error    visible    timeout=4s
    Get Element    id=login-error
