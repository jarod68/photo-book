*** Settings ***
Library    Browser

*** Variables ***
${BASE_URL}     http://localhost:3000
${BROWSER}      chromium
${HEADLESS}     ${TRUE}

*** Keywords ***
Open Home Page
    New Browser    ${BROWSER}    headless=${HEADLESS}
    New Context    locale=fr-FR
    New Page       ${BASE_URL}
    # Wait for the JS modules to populate the DOM (nth=0 avoids strict-mode violation)
    Wait For Elements State    css=#album-grid a.album-card >> nth=0    visible    timeout=8s

Close All Browsers
    Close Browser
