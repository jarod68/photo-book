*** Settings ***
Documentation     The home page and the search, through the interface: sort and grouping
...               (remembered), the hero, the Explore cards, photos dropped on a card,
...               the language switch (kept from page to page, menu on top); the search
...               box and filters in the address, typos, small words, Back.
Resource          ../resources/ui.resource
Suite Setup       Prepare
Suite Teardown    Clean Up

*** Variables ***
${H1}    ui-home-aaa
${H2}    ui-home-zzz

*** Keywords ***
Prepare
    Login As Admin
    Evaluate JavaScript    ${NONE}    () => { localStorage.removeItem('pb.albumSort'); localStorage.removeItem('pb.albumGroup'); }
    Create Album By API    ${H1}
    Create Album By API    ${H2}
    Upload Generated Photos As Admin    ${H1}    2    homea
    Upload Generated Photos As Admin    ${H2}    1    homez
    Admin API    PUT    /api/admin/albums/${H1}/details    {"collection": "Robot collection"}

Clean Up
    Run Keyword And Ignore Error    Evaluate JavaScript    ${NONE}    () => { localStorage.removeItem('pb.albumSort'); localStorage.removeItem('pb.albumGroup'); localStorage.setItem('lang', 'fr'); }
    Delete Albums By API    ${H1}    ${H2}
    Close Browser

Open Home
    Go To    ${BASE_URL}/
    Wait For Elements State    css=#album-grid a.album-card >> nth=0    visible    timeout=10s

Album Card Order
    ${names}=    Evaluate JavaScript    ${NONE}
    ...    () => [...document.querySelectorAll('#album-grid a.album-card')].map((a) => new URL(a.href).searchParams.get('album')).filter((n) => n && n.startsWith('ui-home'))
    RETURN    ${names}

*** Test Cases ***
Sort A To Z Then Most Recent
    Open Home
    Select Options By    id=album-sort    value    name
    ${names}=    Album Card Order
    Should Be Equal    ${names}    ${{ ['${H1}', '${H2}'] }}

Sort Is Remembered
    Open Home
    Select Options By    id=album-sort    value    name
    Reload
    Wait For Elements State    css=#album-grid a.album-card >> nth=0    visible    timeout=10s
    Get Selected Options    id=album-sort    value    ==    name

Group By Collection Shows A Heading
    Open Home
    Select Options By    id=album-group    value    collection
    Get Text    css=#album-grid .album-group-title >> nth=0    ==    Robot collection
    Select Options By    id=album-group    value    none
    Get Element Count    css=#album-grid .album-group-title    ==    0

Group By Year Shows Headings
    Open Home
    Select Options By    id=album-group    value    year
    Get Element Count    css=#album-grid .album-group-title    >=    1
    Select Options By    id=album-group    value    none

Hero Opens The Latest Album
    Open Home
    Wait For Elements State    css=.home-hero-cta    visible    timeout=10s
    ${title}=    Get Text    css=.home-hero-title
    Click    css=.home-hero-cta
    Wait For Url Contains    viewer.html
    Get Text    css=.album-tab.active    contains    ${title}

Explore Cards Lead To The Map And The Globe
    Open Home
    Get Attribute    css=#explore-grid a.album-card >> nth=0    href    contains    map.html
    Get Attribute    css=#explore-grid a.album-card >> nth=1    href    contains    globe.html

Search Button Opens The Search
    Open Home
    Click    css=.home-search-btn
    Wait For Url Contains    search.html

Photos Dropped On A Card Go Into That Album
    Open Home
    ${before}=    Album Photo Count    ${H2}
    Drop Generated Photos On    css=a.album-card[href*="${H2}"]    1    carddrop
    Wait For Elements State    id=upload-overlay    hidden    timeout=30s
    ${after}=    Album Photo Count    ${H2}
    Should Be Equal As Integers    ${after}    ${before + 1}
    Get Text    css=a.album-card[href*="${H2}"] .album-card-count    contains    ${{ str(${before} + 1) }}

Visitors Cannot Drop On Cards
    Open Page Anonymously    /
    Wait For Elements State    css=#album-grid a.album-card >> nth=0    visible    timeout=10s
    Drop Generated Photos On    css=a.album-card[href*="${H2}"]    1    visitor
    Get Element Count    css=#upload-overlay:not([hidden])    ==    0
    Close Context

Language Switch Applies And Is Kept On Other Pages
    Open Home
    Click    css=.lang-btn
    Topmost Element Is    css=.lang-option >> nth=0
    Click    css=.lang-option >> text=English
    Wait For Elements State    css=body.page-home    visible    timeout=10s
    Get Text    css=#explore-grid a.album-card >> nth=0 >> css=.album-card-name    ==    Map
    Go To    ${BASE_URL}/search.html
    Get Text    css=.map-page-title    ==    Search
    Evaluate JavaScript    ${NONE}    () => localStorage.setItem('lang', 'fr')

Search Puts The Query In The Address
    Go To    ${BASE_URL}/search.html
    Fill Text    id=search-q    ${H1}
    Wait For Url Contains    q=${H1}
    Get Element Count    css=.search-tile    ==    2

Search Ignores Small Words
    Go To    ${BASE_URL}/search.html?q=les%20photos%20de%20${H1}
    Wait For Elements State    css=.search-tile >> nth=0    visible    timeout=10s
    Get Element Count    css=.search-tile    ==    2

Search Tolerates A Typo And Says So
    Go To    ${BASE_URL}/search.html?q=homaz
    Wait For Elements State    css=.search-tile >> nth=0    visible    timeout=10s
    Get Text    id=search-count    contains    approch

Search Without Result Says So
    Go To    ${BASE_URL}/search.html?q=qwxzv
    Wait For Elements State    css=#search-results .grid-empty    visible    timeout=10s

Album Filter Narrows The Results
    Go To    ${BASE_URL}/search.html?q=ui-home
    Wait For Elements State    css=.search-tile >> nth=0    visible    timeout=10s
    Select Options By    id=search-album    value    ${H2}
    Wait For Url Contains    album=${H2}
    Get Element Count    css=.search-tile    >=    1
    ${albums}=    Evaluate JavaScript    ${NONE}
    ...    () => [...document.querySelectorAll('.search-tile')].map((a) => new URL(a.href).searchParams.get('album'))
    Should Not Contain    ${albums}    ${H1}

Clear Empties The Search
    Go To    ${BASE_URL}/search.html?q=${H1}
    Wait For Elements State    css=.search-tile >> nth=0    visible    timeout=10s
    Click    id=search-reset
    Get Property    id=search-q    value    ==    ${EMPTY}

Search Result Opens The Photo And Back Returns
    Go To    ${BASE_URL}/search.html?q=${H1}
    Wait For Elements State    css=.search-tile >> nth=0    visible    timeout=10s
    Click    css=.search-tile >> nth=0
    Wait For Url Contains    viewer.html
    Click    css=.album-tab-back
    Wait For Url Contains    q=${H1}
    Get Element Count    css=.search-tile    ==    2

Show More Is Hidden When Everything Is Shown
    Go To    ${BASE_URL}/search.html?q=${H1}
    Wait For Elements State    css=.search-tile >> nth=0    visible    timeout=10s
    Get Element States    id=search-more    contains    hidden
