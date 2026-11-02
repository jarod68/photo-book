*** Settings ***
Documentation     The About page: reached from the home page, its text in the page's
...               language, live figures of the site.
Resource          ../resources/ui.resource
Suite Setup       Open Home Page
Suite Teardown    Close All Browsers

*** Test Cases ***
About Is Linked From The Home Page
    Go To    ${BASE_URL}/
    Wait For Elements State    css=.home-footer a[href="about.html"]    visible    timeout=8s
    Click    css=.home-footer a[href="about.html"]
    Wait For Elements State    css=body.page-about    visible    timeout=8s
    Get Text    id=about-title    ==    À propos

The Text Follows The Language
    Go To    ${BASE_URL}/about.html
    Wait For Elements State    css=#about-body h2 >> nth=0    visible    timeout=8s
    Get Text    css=#about-body h2 >> nth=0    ==    L’idée
    Evaluate JavaScript    ${NONE}    () => localStorage.setItem('lang', 'en')
    Reload
    Wait For Elements State    css=#about-body h2 >> nth=0    visible    timeout=8s
    Get Text    id=about-title    ==    About
    Evaluate JavaScript    ${NONE}    () => localStorage.removeItem('lang')

Live Figures When The Site Has Photos
    Go To    ${BASE_URL}/about.html
    Wait For Elements State    id=about-body    visible    timeout=8s
    ${albums}=    Evaluate JavaScript    ${NONE}    () => fetch('/api/albums').then((r) => r.json()).then((a) => a.length)
    IF    ${albums} > 0
        Wait For Elements State    css=#about-stats dd >> nth=0    visible    timeout=8s
        Get Text    css=#about-stats dd >> nth=0    ==    ${albums.__str__()}
    END
