*** Settings ***
Documentation     The globe's time slider: 72 h back or ahead in 15-minute steps, the
...               simulated date and offset shown, Now to come back, the sun moved
...               (when the browser draws the 3D view), the offset kept by Back.
Resource          ../resources/ui.resource
Suite Setup       Open Home Page
Suite Teardown    Close All Browsers

*** Keywords ***
Open Globe
    # a new address each time: going to the same one again keeps its history
    # entry, and with it the offset left by the previous test
    ${n}=    Evaluate    __import__('time').time_ns()
    Go To    ${BASE_URL}/globe.html?still&at=2026-06-21T12:00:00Z&n=${n}
    Wait For Elements State    id=globe-time-label    visible    timeout=10s
    Get Text    id=globe-time-label    contains    21

Move Slider To
    [Arguments]    ${hours}
    Evaluate JavaScript    id=globe-time-range
    ...    (r) => { r.value = '${hours}'; r.dispatchEvent(new Event('input', { bubbles: true })); }

Sun Direction
    ${s}=    Evaluate JavaScript    ${NONE}
    ...    () => { const v = document.getElementById('globe-space').globeView; return v ? v.sun.x.toFixed(2) : 'none'; }
    RETURN    ${s}

*** Test Cases ***
Slider Starts At Now
    Open Globe
    Get Property    id=globe-time-range    value    ==    0
    Get Text    id=globe-time-label    contains    maintenant
    Get Element Count    css=#globe-time-now[hidden]    ==    1

Range Is 72 Hours Each Way In Quarter Hours
    Open Globe
    Get Attribute    id=globe-time-range    min    ==    -72
    Get Attribute    id=globe-time-range    max    ==    72
    Get Attribute    id=globe-time-range    step    ==    0.25

Moving Ahead Shows The Date And The Offset
    Open Globe
    Move Slider To    12
    Get Text    id=globe-time-label    contains    +12 h
    Get Text    id=globe-time-label    contains    22
    Get Element Count    css=#globe-time-now:not([hidden])    ==    1

Moving Back Shows A Negative Offset
    Open Globe
    Move Slider To    -36.5
    Get Text    id=globe-time-label    contains    −36 h 30

Keyboard Steps A Quarter Of An Hour
    Open Globe
    Focus    id=globe-time-range
    Keyboard Key    press    ArrowRight
    Get Text    id=globe-time-label    contains    +0 h 15

Now Comes Back
    Open Globe
    Move Slider To    -72
    Click    id=globe-time-now
    Get Property    id=globe-time-range    value    ==    0
    Get Element Count    css=#globe-time-now[hidden]    ==    1

The Sun Moves With The Slider
    Open Globe
    ${before}=    Sun Direction
    Pass Execution If    '${before}' == 'none'    no WebGL in this browser: the 3D view did not start
    Move Slider To    12
    Wait Until Keyword Succeeds    5s    250ms    Sun Has Moved From    ${before}

Back Returns To The Time Left
    Open Globe
    Move Slider To    24
    Evaluate JavaScript    ${NONE}    () => { location.href = '/search.html'; }
    Wait For Url Contains    search.html
    Go Back
    Wait For Elements State    id=globe-time-label    visible    timeout=10s
    Get Property    id=globe-time-range    value    ==    24
    Get Text    id=globe-time-label    contains    +24 h

*** Keywords ***
Sun Has Moved From
    [Arguments]    ${before}
    ${now}=    Sun Direction
    Should Not Be Equal    ${now}    ${before}
