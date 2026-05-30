*** Settings ***
Resource          ../resources/common.resource
Suite Setup       Open Geocode Context
Suite Teardown    Close Browser

*** Keywords ***
Open Geocode Context
    New Browser    ${BROWSER}    headless=${HEADLESS}
    New Context    locale=fr-FR
    New Page       ${BASE_URL}
    Wait For Elements State    css=body    visible    timeout=8s

*** Test Cases ***

GET Geocode With Missing Params Returns 400
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/geocode').then(r => r.status)
    Should Be Equal As Integers    ${s}    400

GET Geocode With Non-Numeric Params Returns 400
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/geocode?lat=abc&lng=xyz').then(r => r.status)
    Should Be Equal As Integers    ${s}    400

GET Geocode With Out-Of-Range Latitude Returns 400
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/geocode?lat=999&lng=2').then(r => r.status)
    Should Be Equal As Integers    ${s}    400

GET Geocode With Out-Of-Range Longitude Returns 400
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/geocode?lat=48&lng=999').then(r => r.status)
    Should Be Equal As Integers    ${s}    400

GET Geocode With Valid Coords Returns Location Key
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/geocode?lat=48.8566&lng=2.3522').then(r => r.json())
    Dictionary Should Contain Key    ${data}    location

GET Geocode Second Call Returns Consistent Result
    ${d1}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/geocode?lat=45.5017&lng=-73.5673').then(r => r.json())
    ${d2}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/geocode?lat=45.5017&lng=-73.5673').then(r => r.json())
    Should Be Equal    ${d1}[location]    ${d2}[location]

GET Geocode Coordinates Are Rounded To Three Decimals
    ${d1}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/geocode?lat=48.8566&lng=2.3522').then(r => r.json())
    ${d2}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/geocode?lat=48.8568&lng=2.3524').then(r => r.json())
    Should Be Equal    ${d1}[location]    ${d2}[location]
