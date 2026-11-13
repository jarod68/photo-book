*** Settings ***
Documentation     A trip replayed on the globe: the journal of an album with geotagged photos
...               offers it; the replay page finds the trip's stops (two trips here: a jump
...               between them) and, when the browser draws WebGL, plays to the next stops.
...               An album without places offers no replay, and its page says why.
Resource          ../resources/ui.resource
Suite Setup       Prepare
Suite Teardown    Clean Up

*** Variables ***
${TRIP}     robot-replay
${PLAIN}    robot-replay-plain

*** Keywords ***
Prepare
    Login As Admin And Go To Admin
    Delete Album If Exists    ${TRIP}
    Create Album    ${TRIP}
    Upload Photos To Album    ${TRIP}
    ...    ${FIXTURE_DIR}/gps-a.tiff
    ...    ${FIXTURE_DIR}/gps-b.tiff
    ...    ${FIXTURE_DIR}/gps-c.tiff
    ...    ${FIXTURE_DIR}/gps-d.tiff
    ...    ${FIXTURE_DIR}/gps-e.tiff
    Create Album By API    ${PLAIN}
    ${n}=    Upload Generated Photos As Admin    ${PLAIN}    2    plain
    Should Be Equal As Integers    ${n}    2

Clean Up
    Delete Albums By API    ${TRIP}    ${PLAIN}
    Close Browser

*** Test Cases ***
The Journal Offers The Replay
    Go To    ${BASE_URL}/album.html?album=${TRIP}
    Wait For Elements State    id=carnet-replay    visible    timeout=10s
    Get Text    id=carnet-replay    contains    Rejouer le voyage
    Click    id=carnet-replay
    Wait For Elements State    css=body.page-replay    visible    timeout=10s
    # the old trip (one stop: two photos 600 m apart) and the recent one (two stops)
    Wait For Elements State    css=body[data-stops="3"]    attached    timeout=10s

The Replay Plays Where WebGL Is Drawn
    Go To    ${BASE_URL}/replay.html?album=${TRIP}&speed=4
    Wait For Elements State    css=body[data-replay="ready"], body[data-replay="error"]    attached    timeout=30s
    ${state}=    Get Attribute    css=body    data-replay
    IF    '${state}' == 'error'
        Get Text    id=replay-message    contains    WebGL
        Skip    no WebGL in this browser
    END
    Get Element States    id=replay-play    contains    enabled
    Click    id=replay-play
    Wait For Elements State    css=body[data-replay="playing"]    attached    timeout=5s
    Wait For Condition    Text    id=replay-step    contains    2 / 3    timeout=90s

No Replay Without Places
    Go To    ${BASE_URL}/album.html?album=${PLAIN}
    Wait For Elements State    id=carnet-hero    visible    timeout=10s
    Get Element Count    id=carnet-replay    ==    0
    Go To    ${BASE_URL}/replay.html?album=${PLAIN}
    Wait For Elements State    id=replay-message    visible    timeout=10s
    Get Text    id=replay-message    contains    deux lieux
