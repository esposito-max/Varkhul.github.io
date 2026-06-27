const LANDING_ASSET_BASE = new URL('.', document.currentScript?.src || window.location.href);

/* =========================================
   1. SISTEMA DE ABAS (FOLDER NAVIGATION)
   ========================================= */
function openTab(evt, tabName) {
    const tabcontent = document.getElementsByClassName("tab-content");
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].classList.remove("active");
    }

    const tablinks = document.getElementsByClassName("tab-link");
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].classList.remove("active");
    }

    document.getElementById(tabName).classList.add("active");
    evt.currentTarget.classList.add("active");
}

/* =========================================
   2. SISTEMA DE SUB-ABAS RECURSIVAS (REINJETADO)
   ========================================= */
function openSubTab(evt, subTabName) {
    const menuContainer = evt.currentTarget.parentElement;
    const wrapper = menuContainer.parentElement;

    const contents = wrapper.querySelectorAll(':scope > .sub-content');
    contents.forEach(content => content.classList.remove('active'));

    const tabs = menuContainer.querySelectorAll(':scope > .sub-tab-item');
    tabs.forEach(tab => tab.classList.remove('active'));

    document.getElementById(subTabName).classList.add('active');
    evt.currentTarget.classList.add('active');
}

/* =========================================
   3. SISTEMA DE TOOLTIPS DINÂMICOS (LORE & SPELLS)
   ========================================= */
document.addEventListener("DOMContentLoaded", () => {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    const voidEntryButton = document.querySelector('.void-entry-button');

    voidEntryButton?.addEventListener('click', async (event) => {
        event.preventDefault();
        voidEntryButton.setAttribute('aria-busy', 'true');

        try {
            const { getUsableAuthSession, signedInDestination } = await import('./auth-client.js');
            const session = await getUsableAuthSession();

            if (!session) {
                window.location.assign('./login.html');
                return;
            }

            window.location.assign(await signedInDestination(session));
        } catch (error) {
            console.error('Não foi possível verificar a sessão ativa.', error);
            window.location.assign('./login.html');
        } finally {
            voidEntryButton.removeAttribute('aria-busy');
        }
    });

    let isPinned = false;
    let tooltipStack = [];
    
    let loreDictionary = {};
    let spellsDictionary = {};

    Promise.all([
        fetch(new URL('lore.json', LANDING_ASSET_BASE)).then(res => res.json()),
        fetch(new URL('spells.json', LANDING_ASSET_BASE)).then(res => res.json())
    ])
    .then(([loreData, spellsData]) => {
        loreDictionary = loreData;
        spellsDictionary = spellsData;
    })
    .catch(error => console.error("Erro ao carregar os dados auxiliares:", error));

    document.body.addEventListener('mouseover', (e) => {
        const term = e.target.closest('.lore-term, .spell-term');

        if (term) {
            const parentTooltip = term.closest('.lore-tooltip');
            if (!parentTooltip && isPinned) return;

            let level = 0;
            if (parentTooltip) {
                level = parseInt(parentTooltip.getAttribute('data-level')) + 1;
            }

            clearTooltipsFromLevel(level);
            createTooltip(term, level);
        }
    });

    document.body.addEventListener('mouseout', (e) => {
        if (isPinned) return; 
        const term = e.target.closest('.lore-term, .spell-term');
        if (term && !term.closest('.lore-tooltip')) {
            clearTooltipsFromLevel(0);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 't') {
            if (tooltipStack.length > 0) {
                isPinned = !isPinned;
                
                tooltipStack.forEach((tt, index) => {
                    if (isPinned) {
                        tt.classList.add('pinned');
                        tt.style.pointerEvents = "auto";
                        if (index === 0) tt.querySelector('.tooltip-hint').innerHTML = "Fixado. Aperte <b>T</b> ou <b>Esc</b> para fechar";
                    } else {
                        tt.classList.remove('pinned');
                        tt.style.pointerEvents = "none";
                        if (index === 0) tt.querySelector('.tooltip-hint').innerHTML = "Pressione <b>T</b> para fixar";
                    }
                });
                
                if (!isPinned) clearTooltipsFromLevel(0);
            }
        }
        
        if (e.key === 'Escape') {
            isPinned = false;
            clearTooltipsFromLevel(0);
        }
    });

    function createTooltip(element, level) {
        if (tooltipStack[level] && tooltipStack[level].sourceElement === element) return;

        const key = element.getAttribute('data-key').toLowerCase();
        const isSpell = element.classList.contains('spell-term');
        
        const tt = document.createElement('div');
        tt.sourceElement = element; 
        tt.setAttribute('data-level', level);
        tt.style.zIndex = 1000 + level; 
        tt.style.pointerEvents = isPinned ? "auto" : "none";

        let htmlContent = "";
        
        if (isSpell) {
            tt.className = 'lore-tooltip visible spell-format' + (isPinned ? ' pinned' : '') + (level > 0 ? ' nested' : '');
            const spell = spellsDictionary[key];
            
            if (spell) {
                const schoolClass = `school-${(spell.school || 'universal').toLowerCase()}`;
                
                htmlContent = `
                    <div class="spell-header">
                        <h4 class="${schoolClass}">${spell.name}</h4>
                        <em>${spell.level}</em>
                    </div>
                    
                    <div class="spell-stats-grid">
                        <div class="stat-col">
                            <p><strong>Tempo de Conjuração:</strong> ${spell.casting_time}</p>
                            <p><strong>Componentes:</strong> ${spell.components}</p>
                        </div>
                        <div class="stat-col">
                            <p><strong>Alcance:</strong> ${spell.range}</p>
                            <p><strong>Duração:</strong> ${spell.duration}</p>
                        </div>
                    </div>
                    
                    <div class="spell-description">${spell.description}</div>
                `;
            } else {
                htmlContent = `<div class="tooltip-content"><i>Magia não encontrada...</i></div>`;
            }
        } else {
            tt.className = 'lore-tooltip visible' + (isPinned ? ' pinned' : '') + (level > 0 ? ' nested' : '');
            const definition = loreDictionary[key] || "<i>Definição não encontrada...</i>";
            htmlContent = `<div class="tooltip-content">${definition}</div>`;
        }

        if (level === 0) {
             htmlContent += `<div class="tooltip-hint">${isPinned ? 'Fixado. Aperte <b>T</b> ou <b>Esc</b> para fechar' : 'Pressione <b>T</b> para fixar'}</div>`;
        }
        
        tt.innerHTML = htmlContent;
        document.body.appendChild(tt);
        tooltipStack[level] = tt;

        const rect = element.getBoundingClientRect();
        let topPosition = rect.top + window.scrollY - tt.offsetHeight - 15;
        let leftPosition = rect.left + window.scrollX + (rect.width / 2);

        if (level > 0) {
            leftPosition += 20; 
            topPosition -= 20;  
        }

        tt.style.top = topPosition + 'px';
        tt.style.left = leftPosition + 'px';
    }

    function clearTooltipsFromLevel(level) {
        while (tooltipStack.length > level) {
            const tt = tooltipStack.pop();
            if (tt && tt.parentNode) tt.parentNode.removeChild(tt);
        }
    }
});
