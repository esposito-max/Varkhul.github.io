import { authenticatedFetch, initializeLogoutButtons, requireAuthenticatedPage } from './auth-client.js';
const root=document.documentElement;
const themeButton=document.querySelector('#theme-toggle');
const list=document.querySelector('#lore-list');
const reader=document.querySelector('#lore-reader');
const form=document.querySelector('#lore-search-form');
const input=document.querySelector('#lore-search-input');
const sidebarToggle=document.querySelector('#sidebar-toggle');
const lorePageLayout=document.querySelector('#lore-page-layout');
function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
async function json(url){const r=await authenticatedFetch(url);const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(p.error||'A solicitação falhou.');return p;}
function initTheme(){const saved=localStorage.getItem('chronicle-theme');if(saved)root.dataset.theme=saved;themeButton.textContent=root.dataset.theme==='light'?'Usar tema escuro':'Usar tema claro';}
themeButton.addEventListener('click',()=>{root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';localStorage.setItem('chronicle-theme',root.dataset.theme);initTheme();});
sidebarToggle?.addEventListener('click',()=>{const collapsed=lorePageLayout.classList.toggle('sidebar-collapsed');sidebarToggle.setAttribute('aria-expanded',String(!collapsed));sidebarToggle.textContent=collapsed?'Mostrar menu':'Ocultar menu';});
function markdown(value){
  const safe=esc(value).replace(/\r\n?/g,'\n'); const lines=safe.split('\n'); let html=''; let listOpen=false;
  const inline=(line)=>line.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/`(.+?)`/g,'<code>$1</code>');
  for(const raw of lines){const line=raw.trim();if(/^[-*] /.test(line)){if(!listOpen){html+='<ul>';listOpen=true;}html+=`<li>${inline(line.slice(2))}</li>`;continue;}if(listOpen){html+='</ul>';listOpen=false;}if(!line){continue;}const h=line.match(/^(#{1,4})\s+(.+)$/);if(h){const n=h[1].length+1;html+=`<h${n}>${inline(h[2])}</h${n}>`;}else{html+=`<p>${inline(line)}</p>`;}}
  if(listOpen)html+='</ul>';return html;
}
async function loadList(q=''){try{const p=await json(`/api/lore?q=${encodeURIComponent(q)}`);const items=p.items||[];list.innerHTML=items.length?items.map(i=>`<button type="button" class="lore-list-item" data-slug="${esc(i.slug)}"><span class="eyebrow">${esc(i.category||'Lore')}</span><strong>${esc(i.title)}</strong><small>${esc(i.excerpt||'')}</small></button>`).join(''):'<div class="empty-state">Nenhuma página revelada encontrada.</div>';document.querySelectorAll('[data-slug]').forEach(b=>b.addEventListener('click',()=>openLore(b.dataset.slug)));return items;}catch(e){list.innerHTML=`<div class="alert error">${esc(e.message)}</div>`;return[];}}
async function openLore(slug){try{reader.innerHTML='<div class="empty-state">Abrindo página...</div>';const item=await json(`/api/lore/${encodeURIComponent(slug)}`);reader.innerHTML=`<header><p class="eyebrow">${esc(item.category||'Lore')}</p><h2>${esc(item.title)}</h2>${item.tags?.length?`<div class="lore-tags">${item.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</div>`:''}</header><div class="lore-content">${markdown(item.content||'')}</div>`;history.replaceState(null,'',`./lore.html?slug=${encodeURIComponent(slug)}`);}catch(e){reader.innerHTML=`<div class="alert error">${esc(e.message)}</div>`;}}
form.addEventListener('submit',e=>{e.preventDefault();loadList(input.value.trim());});
async function boot(){if(!await requireAuthenticatedPage('player'))return;initTheme();const items=await loadList();const requested=new URLSearchParams(location.search).get('slug');if(requested)openLore(requested);else if(items.length)openLore(items[0].slug);}
boot();

initializeLogoutButtons();
