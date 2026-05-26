*** Settings ***
Resource          ../resources/common.resource
Suite Setup       Open Map Page
Suite Teardown    Close Browser

*** Keywords ***
Open Map Page
    New Browser    ${BROWSER}    headless=${HEADLESS}
    New Context    locale=fr-FR
    New Page       ${BASE_URL}/map.html
    Wait For Elements State    id=world-map    visible    timeout=10s

*** Test Cases ***

Map Container Is Rendered
    ${count}=    Get Element Count    id=world-map
    Should Be Equal As Integers    ${count}    1

Photo Count Element Is Present
    ${count}=    Get Element Count    id=map-page-count
    Should Be Equal As Integers    ${count}    1

Route Toggle Button Is Present
    ${count}=    Get Element Count    id=route-toggle
    Should Be Equal As Integers    ${count}    1

Route Toggle Is Active By Default
    ${classes}=    Get Attribute    id=route-toggle    class
    Should Contain    ${classes}    active

GET /api/map Returns An Array
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/map').then(r => r.json())
    Should Be True    isinstance(${data}, list)

GET /api/map Photo Objects Have Required Properties
    ${valid}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/map').then(r => r.json())
    ...    .then(photos => photos.length === 0 ||
    ...    photos.every(p => p.gps && p.album && p.filename && p.url))
    Should Be True    ${valid}
