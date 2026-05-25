*** Settings ***
Resource          ../resources/common.resource
Suite Setup       Open Home Page
Suite Teardown    Close All Browsers

*** Test Cases ***
Page Title Is Photo Book
    Get Title    ==    Photo Book

Logo Heading Is Visible
    Get Text    css=h1.home-logo    ==    Photo Book

Album Grid Is Present
    Get Element Count    css=#album-grid    ==    1

Map Card Is Present
    Get Element Count    css=a[href="map.html"].album-card    ==    1

Globe Card Is Present
    Get Element Count    css=a[href="globe.html"].album-card    ==    1

Map Card Label Is Correct
    Get Text    css=a[href="map.html"] .album-card-name    ==    Carte

Globe Card Label Is Correct
    Get Text    css=a[href="globe.html"] .album-card-name    ==    Globe 3D

Auth Area Is Rendered
    Get Element Count    css=#home-auth    ==    1

Summary Text Appears
    ${text}=    Get Text    css=#summary
    Should Not Be Empty    ${text}
