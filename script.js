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
   2. SISTEMA DE TOOLTIPS DINÂMICOS (LORE & SPELLS)
   ========================================= */
document.addEventListener("DOMContentLoaded", () => {
    let isPinned = false;
    let tooltipStack = [];
    
    let loreDictionary = {};
    let spellsDictionary = {};

    // 1. Carregar os arquivos JSON simultaneamente
    Promise.all([
        fetch('lore.json').then(res => res.json()),
        fetch('spells.json').then(res => res.json())
    ])
    .then(([loreData, spellsData]) => {
        loreDictionary = loreData;
        spellsDictionary = spellsData;
    })
    .catch(error => console.error("Erro ao carregar dicionários JSON:", error));

    // 2. Delegação de Eventos de Mouse (Hover)
    document.body.addEventListener('mouseover', (e) => {
        const term = e.target.closest('.lore-term, .spell-term');

        if (term) {
            const parentTooltip = term.closest('.lore-tooltip');
            
            // Se as tooltips estiverem fixadas, só permitimos novas tooltips se o mouse estiver DENTRO de uma já aberta
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
        // Se sair de um termo que não está dentro de uma tooltip, limpamos tudo
        if (term && !term.closest('.lore-tooltip')) {
            clearTooltipsFromLevel(0);
        }
    });

    // 3. Listener de Teclado (Tecla T para Fixar/Esc para Sair)
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

    // 4. Função Principal de Criação de Tooltips
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
        
        // --- FORMATAÇÃO DE MAGIAS ---
        if (isSpell) {
            tt.className = 'lore-tooltip visible spell-format' + (isPinned ? ' pinned' : '') + (level > 0 ? ' nested' : '');
            const spell = spellsDictionary[key];
            
            if (spell) {
                // Adicionamos a classe baseada na escola de magia para cores dinâmicas
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
        }
        // --- FORMATAÇÃO DE LORE (CORRIGIDO COM BACKTICKS) ---
        else {
            tt.className = 'lore-tooltip visible' + (isPinned ? ' pinned' : '') + (level > 0 ? ' nested' : '');
            const definition = loreDictionary[key] || "<i>Definição não encontrada...</i>";
            htmlContent = `<div class="tooltip-content">${definition}</div>`;
        }

        // Adicionar dica de fixação apenas na primeira tooltip da pilha
        if (level === 0) {
             htmlContent += `<div class="tooltip-hint">${isPinned ? 'Fixado. Aperte <b>T</b> ou <b>Esc</b> para fechar' : 'Pressione <b>T</b> para fixar'}</div>`;
        }
        
        tt.innerHTML = htmlContent;
        document.body.appendChild(tt);
        tooltipStack[level] = tt;

        // Lógica de Posicionamento
        const rect = element.getBoundingClientRect();
        let topPosition = rect.top + window.scrollY - tt.offsetHeight - 15;
        let leftPosition = rect.left + window.scrollX + (rect.width / 2);

        // Efeito de cascata para tooltips aninhadas (nested)
        if (level > 0) {
            leftPosition += 20; 
            topPosition -= 20;  
        }

        tt.style.top = topPosition + 'px';
        tt.style.left = leftPosition + 'px';
    }

    // Função para limpar a pilha de tooltips a partir de um nível específico
    function clearTooltipsFromLevel(level) {
        while (tooltipStack.length > level) {
            const tt = tooltipStack.pop();
            if (tt && tt.parentNode) tt.parentNode.removeChild(tt);
        }
    }
});

/* =========================================
    SISTEMA DE SUB-ABAS (Adicionado)
========================================= */
function openSubTab(evt, subTabName) {
    // Esconde todo o conteúdo de sub-abas
    const allSubContents = document.querySelectorAll('.sub-content');
    allSubContents.forEach(content => content.classList.remove('active'));    // Tira o destaque de todos os botões de sub-abas
    const allSubLinks = document.querySelectorAll('.sub-tab-item');
    allSubLinks.forEach(link => link.classList.remove('active'));    // Mostra apenas o alvo clicado
    document.getElementById(subTabName).classList.add('active');
    evt.currentTarget.classList.add('active');
}