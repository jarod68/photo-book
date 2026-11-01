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

Summary Text Contains A Number
    ${text}=    Get Text    css=#summary
    Should Match Regexp    ${text}    \\d+

Anonymous User Sees Sign In Link
    ${count}=    Get Element Count    css=a[href="/login.html"]
    Should Be Equal As Integers    ${count}    1

Anonymous User Does Not See Admin Link
    ${count}=    Get Element Count    css=a[href="/admin.html"]
    Should Be Equal As Integers    ${count}    0

GET Albums API Returns Array
    ${data}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums').then(r => r.json())
    Should Be True    isinstance(${data}, list)

GET Albums Entries Have Name And Count Fields
    ${valid}=    Evaluate JavaScript    ${NONE}
    ...    () => fetch('/api/albums').then(r => r.json())
    ...    .then(albums => albums.length === 0 || albums.every(a => a.name && 'count' in a))
    Should Be True    ${valid}

Built App Serves The Service Worker And The App Manifest
    [Documentation]    Push notifications need /sw.js at the site root, the installable app
    ...                its manifest and icons — files the build must copy (it once forgot sw.js).
    ${statuses}=    Evaluate JavaScript    ${None}
    ...    () => Promise.all(['/sw.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/maskable-512.png']
    ...      .map((u) => fetch(u).then((r) => r.status)))
    Should Be Equal As Strings    ${statuses}    [200, 200, 200, 200]
