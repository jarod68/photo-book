*** Settings ***
Documentation     The viewer, through the interface: the address follows the photo, the
...               like button, the info panel, photo order, slideshow, album tabs, the ⋯
...               menu (add, delete, share), photos dropped on it, the ← button, and
...               what a visitor does not get.
Resource          ../resources/ui.resource
Suite Setup       Prepare
Suite Teardown    Clean Up

*** Variables ***
${V}     ui-viewer
${V2}    ui-viewer-two
${VR}    ui-viewer-restricted
${VE}    ui-viewer-exif

*** Keywords ***
Prepare
    Login As Admin
    Create Album By API    ${V}
    Create Album By API    ${V2}
    Create Album By API    ${VR}
    Upload Generated Photos As Admin    ${V}     4    v
    Upload Generated Photos As Admin    ${V2}    1    w
    Upload Generated Photos As Admin    ${VR}    1    r
    Make Album Restricted For    ${VR}
    # a photo with EXIF and GPS (the info panel needs data), through the admin's window
    Create Album By API    ${VE}
    Go To Admin Page
    Upload Photos To Album    ${VE}    ${FIXTURE_DIR}/gps-a.tiff

Clean Up
    Delete Albums By API    ${V}    ${V2}    ${VR}    ${VE}
    Close Browser

Open Viewer
    [Arguments]    ${album}=${V}    ${photo}=${EMPTY}
    ${q}=    Set Variable If    '${photo}'    &photo=${photo}    ${EMPTY}
    Go To    ${BASE_URL}/viewer.html?album=${album}${q}
    Wait For Elements State    css=#thumbnails .thumb.active    visible    timeout=10s

Thumb Count Is
    [Arguments]    ${n}
    Get Element Count    css=#thumbnails .thumb    ==    ${n}

*** Test Cases ***
The Address Follows The Photo Shown
    Open Viewer
    Click    css=#thumbnails .thumb >> nth=2
    ${name}=    Get Text    id=photo-name
    Wait For Url Contains    photo=${name}

Opening The Address Of A Photo Shows That Photo
    Open Viewer    ${V}    v-3.png
    Get Text    id=photo-name    ==    v-3

Like Toggles On And Off
    Open Viewer
    Get Attribute    id=like-btn    aria-pressed    ==    false
    Click    id=like-btn
    Get Attribute    id=like-btn    aria-pressed    ==    true
    Get Text    id=like-count    ==    1
    Click    id=like-btn
    Get Attribute    id=like-btn    aria-pressed    ==    false

Info Panel Opens And Closes
    Open Viewer    ${VE}
    Wait For Elements State    id=exif-toggle    visible
    Click    id=exif-toggle
    Wait For Elements State    id=exif-panel    visible
    Get Classes    id=viewer    contains    exif-open
    Click    id=exif-toggle
    Wait For Elements State    id=exif-panel    hidden

Order Button Switches To Chronological And Back
    Open Viewer
    ${before}=    Get Attribute    id=order-btn    aria-pressed
    Click    id=order-btn
    Get Attribute    id=order-btn    aria-pressed    !=    ${before}
    Click    id=order-btn
    Get Attribute    id=order-btn    aria-pressed    ==    ${before}

Slideshow Starts And Stops
    Open Viewer
    Click    id=slideshow-btn
    Get Attribute    id=slideshow-btn    aria-pressed    ==    true
    # playing, the interface hides: the space bar stops it (its button's tooltip says so)
    Keyboard Key    press    Space
    Get Attribute    id=slideshow-btn    aria-pressed    ==    false

Album Tabs Switch Albums
    Open Viewer
    Click    css=.album-tab >> text=${V2}
    Wait For Url Contains    album=${V2}
    Thumb Count Is    1
    Get Classes    css=.album-tab.active    contains    active
    Get Text    css=.album-tab.active    contains    ${V2}

Keyboard Arrows Move Between Photos
    Open Viewer
    ${first}=    Get Text    id=photo-name
    Keyboard Key    press    ArrowRight
    Get Text    id=photo-name    !=    ${first}
    Keyboard Key    press    ArrowLeft
    Get Text    id=photo-name    ==    ${first}

Admin Menu Offers Add Delete Share
    Open Viewer    ${VR}
    Click    id=photo-actions-toggle
    Wait For Elements State    id=upload-btn    visible
    Wait For Elements State    id=delete-btn    visible
    Wait For Elements State    id=share-btn    visible
    Keyboard Key    press    Escape

Add Photos From The Menu
    Open Viewer
    Click    id=photo-actions-toggle
    Click    id=upload-btn
    Wait For Elements State    id=upload-overlay    visible
    Get Text    id=upload-album-name    ==    ${V}
    Upload File By Selector    id=upload-file-input    ${FIXTURE_DIR}/test-photo-1.png
    Click    id=upload-start-btn
    Wait For Elements State    id=upload-overlay    hidden    timeout=30s
    Thumb Count Is    5
    # the viewer shows the photo just added
    Get Text    id=photo-name    ==    test-photo-1

Photos Dropped On The Viewer Are Added
    Open Viewer    ${V2}
    Drop Generated Photos On    id=viewer    1    dropped
    Wait For Elements State    id=upload-overlay    hidden    timeout=30s
    Thumb Count Is    2
    Get Text    id=photo-name    matches    ^dropped-0

Delete A Photo From The Menu
    Open Viewer    ${V2}
    Thumb Count Is    2
    Handle Future Dialogs    action=accept
    Click    id=photo-actions-toggle
    Click    id=delete-btn
    Thumb Count Is    1

Share Link For A Restricted Album
    Open Viewer    ${VR}
    Click    id=photo-actions-toggle
    Click    id=share-btn
    Wait For Elements State    id=share-modal    visible
    Click    id=share-create-btn
    Get Property    id=share-url    value    contains    share=
    Click    id=share-modal-close
    Wait For Elements State    id=share-modal    hidden

Shared Link Opens The Restricted Album Without Account
    Open Viewer    ${VR}
    Click    id=photo-actions-toggle
    Click    id=share-btn
    Click    id=share-create-btn
    ${url}=    Get Property    id=share-url    value    contains    share=
    Open Page Anonymously
    Go To    ${url}
    Wait For Elements State    css=#thumbnails .thumb >> nth=0    visible    timeout=10s
    # that album, not another one
    Get Text    css=.album-tab.active    contains    ${VR}
    Get Text    id=photo-name    ==    r-0
    Close Context

Back Button Returns To The Search Results
    Go To    ${BASE_URL}/search.html?q=${V}
    Wait For Elements State    css=.search-tile >> nth=0    visible    timeout=10s
    Click    css=.search-tile >> nth=0
    Wait For Url Contains    viewer.html
    Wait For Elements State    css=#thumbnails .thumb.active    visible    timeout=10s
    Click    css=.album-tab-back
    Wait For Url Contains    search.html
    Get Property    id=search-q    value    ==    ${V}
    Get Element Count    css=.search-tile    >    0

Back Button From A Direct Link Goes Home
    Open Page Anonymously    /viewer.html?album=${V}
    Wait For Elements State    css=#thumbnails .thumb >> nth=0    visible    timeout=10s
    Click    css=.album-tab-back
    Wait For Elements State    css=body.page-home    visible    timeout=8s
    Close Context

Visitor Gets No Add Delete Or Share
    Open Page Anonymously    /viewer.html?album=${V}
    Wait For Elements State    css=#thumbnails .thumb >> nth=0    visible    timeout=10s
    Get Element States    id=upload-btn    contains    hidden
    Get Element States    id=delete-btn    contains    hidden
    # a drop does nothing for a visitor: no veil, no upload window
    Drop Generated Photos On    id=viewer    1    visitor
    Get Element States    id=viewer-drop    contains    hidden
    Get Element Count    css=#upload-overlay:not([hidden])    ==    0
    Close Context

Visitor Cannot Open The Restricted Album
    [Documentation]    Asked for it, the viewer falls back to a visible album: the restricted one
    ...                shows nowhere — not in the tabs, not its photo.
    Open Page Anonymously    /viewer.html?album=${VR}
    Wait For Elements State    css=.album-tab.active    visible    timeout=10s
    Get Element Count    css=.album-tab >> text=${VR}    ==    0
    Get Text    id=photo-name    !=    r-0
    Close Context

Language Menu Opens Above The Photo
    Open Viewer
    Click    css=.lang-btn
    Wait For Elements State    css=.lang-menu    visible
    Topmost Element Is    css=.lang-option >> nth=0
    Keyboard Key    press    Escape
