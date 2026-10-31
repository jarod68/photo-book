*** Settings ***
Library    Browser

*** Variables ***
${BASE_URL}       http://localhost:3000
${BROWSER}        chromium
${HEADLESS}       ${TRUE}
${ADMIN_USER}     admin
${ADMIN_PASS}     ${EMPTY}          # injected via --variable ADMIN_PASS:<value>
${BASIC_USER}     robot-basic
${BASIC_PASS}     Robot@basic1
${FIXTURE_DIR}    ${CURDIR}/../fixtures

*** Keywords ***
Open Home Page
    New Browser    ${BROWSER}    headless=${HEADLESS}
    New Context    locale=fr-FR
    New Page       ${BASE_URL}
    # the Explore row's map card: present even with no album
    Wait For Elements State    css=a.album-card >> nth=0    visible    timeout=8s

Close All Browsers
    Close Browser

Wait For Url Contains
    [Arguments]    ${fragment}    ${timeout}=8s
    Wait Until Keyword Succeeds    ${timeout}    500ms    _Url Should Contain    ${fragment}

_Url Should Contain
    [Arguments]    ${fragment}
    ${url}=    Get URL
    Should Contain    ${url}    ${fragment}
