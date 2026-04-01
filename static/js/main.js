// main.js

let map;
let layers = {}; // Holds light and dark tiles
let currentTileLayer;
let averias = [];
let marcadoresCluster = L.markerClusterGroup({
    chunkedLoading: true,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false
});
let selectedTerritorio = ''; // Global territory filter
let shouldFitBounds = false; // Flag to auto-zoom map on territory/search change

// Elementos DOM
const searchInput = document.getElementById('searchInput');
const updateTimeEl = document.getElementById('updateTime');
const statsTerritorios = document.getElementById('statsTerritorios');
const statsMunicipios = document.getElementById('statsMunicipios');
const eventsList = document.getElementById('eventsList');
const totalAveriasEl = document.getElementById('totalAverias');
const themeToggle = document.getElementById('themeToggle');
const htmlEl = document.documentElement;
const territorySelect = document.getElementById('territorySelect');

// Control de Tabs en móvil
const mobileNavBtns = document.querySelectorAll('.nav-btn');
const leftPanel = document.getElementById('left-panel');
const rightPanel = document.getElementById('right-panel');

// Bottom Sheet Draggable
const bottomSheet = document.getElementById('bottomSheet');
const dragHandle = document.getElementById('dragHandle');

// Iconos Leaflet personalizados
const dangerIcon = L.divIcon({
    className: 'custom-div-icon',
    html: "<div style='background-color:var(--danger, #ef4444);width:15px;height:15px;border-radius:50%;border:2px solid white;box-shadow:0 0 10px rgba(0,0,0,0.5);'></div>",
    iconSize: [15, 15],
    iconAnchor: [7.5, 7.5]
});

const warnIcon = L.divIcon({
    className: 'custom-div-icon',
    html: "<div style='background-color:var(--warning, #f59e0b);width:15px;height:15px;border-radius:50%;border:2px solid white;box-shadow:0 0 10px rgba(0,0,0,0.5);'></div>",
    iconSize: [15, 15],
    iconAnchor: [7.5, 7.5]
});

// --- PUSH NOTIFICATIONS ---
const notifToggle = document.getElementById('notifToggle');
const notifModal = document.getElementById('notifModal');
const notifClose = document.getElementById('notifClose');
const notifSearch = document.getElementById('notifSearch');
const notifMunicipioList = document.getElementById('notifMunicipioList');
const notifCount = document.getElementById('notifCount');
const notifSave = document.getElementById('notifSave');
const notifStatus = document.getElementById('notifStatus');

let allMunicipiosNotif = [];
let selectedMunicipiosNotif = new Set(JSON.parse(localStorage.getItem('emonitor_notif_municipios') || '[]'));

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

function updateNotifCount() {
    notifCount.textContent = `${selectedMunicipiosNotif.size} poblaciones seleccionadas`;
}

function renderNotifMunicipios(filter = '') {
    const term = filter.toLowerCase();
    const filtered = allMunicipiosNotif.filter(m => m.toLowerCase().includes(term));
    notifMunicipioList.innerHTML = '';

    if (filtered.length === 0) {
        notifMunicipioList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">No se encontraron poblaciones.</div>';
        return;
    }

    // Seleccionadas primero, luego el resto
    const selected = filtered.filter(m => selectedMunicipiosNotif.has(m));
    const unselected = filtered.filter(m => !selectedMunicipiosNotif.has(m));
    const sorted = [...selected, ...unselected];

    sorted.forEach((mun, idx) => {
        // Separador entre seleccionadas y no-seleccionadas
        if (idx === selected.length && selected.length > 0 && unselected.length > 0) {
            const sep = document.createElement('div');
            sep.className = 'notif-separator';
            sep.innerHTML = '<span>Todas las poblaciones</span>';
            notifMunicipioList.appendChild(sep);
        }

        const div = document.createElement('div');
        const isChecked = selectedMunicipiosNotif.has(mun);
        div.className = `notif-mun-item${isChecked ? ' checked' : ''}`;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isChecked;
        cb.id = `notif-cb-${mun}`;

        const label = document.createElement('label');
        label.htmlFor = cb.id;
        if (isChecked) {
            label.innerHTML = `<i class="fa-solid fa-bell" style="color:var(--warning);margin-right:6px;font-size:0.75rem;"></i>${mun}`;
        } else {
            label.textContent = mun;
        }

        div.appendChild(cb);
        div.appendChild(label);

        div.addEventListener('click', (e) => {
            if (e.target === cb) return;
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change'));
        });

        cb.addEventListener('change', () => {
            if (cb.checked) {
                selectedMunicipiosNotif.add(mun);
                div.classList.add('checked');
                label.innerHTML = `<i class="fa-solid fa-bell" style="color:var(--warning);margin-right:6px;font-size:0.75rem;"></i>${mun}`;
            } else {
                selectedMunicipiosNotif.delete(mun);
                div.classList.remove('checked');
                label.textContent = mun;
            }
            updateNotifCount();
        });

        notifMunicipioList.appendChild(div);
    });
}

async function openNotifModal() {
    notifModal.classList.remove('hidden');
    notifSearch.value = '';
    updateNotifCount();

    // Reset to config tab
    document.querySelectorAll('.notif-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.notif-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.notif-tab[data-tab="config"]').classList.add('active');
    document.getElementById('notifTabConfig').classList.add('active');
    document.querySelector('.notif-modal-footer').style.display = 'flex';

    // Check push support
    const pushSupported = ('serviceWorker' in navigator) && ('PushManager' in window);
    if (!pushSupported) {
        notifStatus.textContent = 'Tu navegador no soporta notificaciones push.';
        notifStatus.className = 'notif-status error';
        notifSave.disabled = true;
        return;
    }

    if (Notification.permission === 'denied') {
        notifStatus.textContent = 'Las notificaciones están bloqueadas. Actívalas en los ajustes del navegador.';
        notifStatus.className = 'notif-status error';
        notifSave.disabled = true;
        return;
    }

    // Check if already subscribed
    if (window.swRegistration) {
        const sub = await window.swRegistration.pushManager.getSubscription();
        if (sub && selectedMunicipiosNotif.size > 0) {
            notifStatus.textContent = `Alertas activas para ${selectedMunicipiosNotif.size} poblaciones.`;
            notifStatus.className = 'notif-status success';
        } else {
            notifStatus.textContent = 'Selecciona poblaciones y pulsa Guardar para recibir alertas.';
            notifStatus.className = 'notif-status';
        }
    } else {
        notifStatus.textContent = 'Selecciona poblaciones y pulsa Guardar para recibir alertas.';
        notifStatus.className = 'notif-status';
    }

    notifSave.disabled = false;

    // Load municipios list
    try {
        notifMunicipioList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...</div>';
        const resp = await fetch('/api/municipios');
        allMunicipiosNotif = await resp.json();
        renderNotifMunicipios();
    } catch (e) {
        notifMunicipioList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--danger);">Error al cargar poblaciones.</div>';
    }
}

async function saveNotifPreferences() {
    const municipios = Array.from(selectedMunicipiosNotif);
    notifSave.disabled = true;
    notifStatus.textContent = 'Guardando...';
    notifStatus.className = 'notif-status';

    try {
        if (municipios.length === 0) {
            // Desuscribir
            if (window.swRegistration) {
                const sub = await window.swRegistration.pushManager.getSubscription();
                if (sub) {
                    await fetch('/api/push/unsubscribe', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ endpoint: sub.endpoint })
                    });
                    await sub.unsubscribe();
                }
            }
            localStorage.removeItem('emonitor_notif_municipios');
            notifToggle.classList.remove('notif-active');
            notifStatus.textContent = 'Alertas desactivadas.';
            notifStatus.className = 'notif-status';
        } else {
            // Solicitar permiso si no lo tenemos
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                notifStatus.textContent = 'Permiso de notificaciones denegado.';
                notifStatus.className = 'notif-status error';
                notifSave.disabled = false;
                return;
            }

            // Obtener o crear suscripción push
            if (!window.swRegistration) {
                notifStatus.textContent = 'Service Worker no disponible. Recarga la página.';
                notifStatus.className = 'notif-status error';
                notifSave.disabled = false;
                return;
            }

            let sub = await window.swRegistration.pushManager.getSubscription();
            if (!sub) {
                // Obtener clave VAPID
                const keyResp = await fetch('/api/push/vapid-public-key');
                const keyData = await keyResp.json();
                if (!keyData.publicKey) {
                    notifStatus.textContent = 'Error: claves VAPID no configuradas en el servidor.';
                    notifStatus.className = 'notif-status error';
                    notifSave.disabled = false;
                    return;
                }

                sub = await window.swRegistration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
                });
            }

            // Enviar suscripción + municipios al servidor
            const subJSON = sub.toJSON();
            const resp = await fetch('/api/push/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subscription: {
                        endpoint: sub.endpoint,
                        keys: {
                            p256dh: subJSON.keys.p256dh,
                            auth: subJSON.keys.auth
                        }
                    },
                    municipios: municipios
                })
            });

            if (!resp.ok) {
                throw new Error('Error del servidor');
            }

            localStorage.setItem('emonitor_notif_municipios', JSON.stringify(municipios));
            notifToggle.classList.add('notif-active');
            notifStatus.textContent = `Alertas activas para ${municipios.length} poblaciones.`;
            notifStatus.className = 'notif-status success';
        }
    } catch (e) {
        console.error('Error saving push preferences:', e);
        notifStatus.textContent = `Error: ${e.message || 'No se pudieron guardar las alertas.'}`;
        notifStatus.className = 'notif-status error';
    }

    notifSave.disabled = false;
}

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initMap();
    loadTerritorios(); // Load territory options and then fetch data
    initBottomSheet();

    // Init notification bell state
    if (selectedMunicipiosNotif.size > 0) {
        notifToggle.classList.add('notif-active');
    }
    
    setInterval(() => {
        fetchData();
        fetchStats();
    }, 60000);

    searchInput.addEventListener('input', () => {
        shouldFitBounds = true;
        renderMapAndList();
    });


    themeToggle.addEventListener('click', toggleTheme);

    // Notification modal events
    notifToggle.addEventListener('click', openNotifModal);
    notifClose.addEventListener('click', () => notifModal.classList.add('hidden'));
    notifModal.addEventListener('click', (e) => { if (e.target === notifModal) notifModal.classList.add('hidden'); });
    notifSearch.addEventListener('input', () => renderNotifMunicipios(notifSearch.value));
    notifSave.addEventListener('click', saveNotifPreferences);

    // Notification modal tabs
    document.querySelectorAll('.notif-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.notif-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.notif-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            if (target === 'config') {
                document.getElementById('notifTabConfig').classList.add('active');
                // Show footer (save button)
                document.querySelector('.notif-modal-footer').style.display = 'flex';
            } else {
                document.getElementById('notifTabHistory').classList.add('active');
                // Hide footer on history tab
                document.querySelector('.notif-modal-footer').style.display = 'none';
                loadNotifHistory();
            }
        });
    });
    
    // Territory select change handler
    territorySelect.addEventListener('change', () => {
        selectedTerritorio = territorySelect.value;
        localStorage.setItem('emonitor_territorio', selectedTerritorio);
        
        // Visual feedback
        const box = territorySelect.parentElement;
        box.classList.add('territory-changed');
        setTimeout(() => box.classList.remove('territory-changed'), 600);
        
        // Toggle active state indicator
        if (selectedTerritorio) {
            box.classList.add('territory-active');
        } else {
            box.classList.remove('territory-active');
        }
        
        // Refetch everything with the new territory filter
        shouldFitBounds = true;
        fetchData();
        fetchStats();
    });
    
    mobileNavBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            mobileNavBtns.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            const target = e.currentTarget.dataset.target;
            if (target === 'left-panel') {
                leftPanel.classList.remove('mobile-hidden');
                rightPanel.classList.add('mobile-hidden');
            } else {
                rightPanel.classList.remove('mobile-hidden');
                leftPanel.classList.add('mobile-hidden');
            }
            // Expande un poco al cambiar de pestaña si estaba escondido
            if (bottomSheet && bottomSheet.clientHeight < window.innerHeight * 0.4) {
                 bottomSheet.style.height = '50vh';
            }
        });
    });
});

async function loadTerritorios() {
    try {
        const response = await fetch('/api/territorios');
        const territorios = await response.json();
        
        // Clear and rebuild options
        territorySelect.innerHTML = '<option value="">Toda España</option>';
        territorios.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            territorySelect.appendChild(opt);
        });
        
        // Restore saved selection
        const saved = localStorage.getItem('emonitor_territorio');
        if (saved && territorios.includes(saved)) {
            selectedTerritorio = saved;
            territorySelect.value = saved;
            territorySelect.parentElement.classList.add('territory-active');
            shouldFitBounds = true;
        }
        
        // Now fetch data with the restored territory
        fetchData();
        fetchStats();
    } catch (e) {
        console.error('Error loading territorios:', e);
        // Still fetch data even if territory list fails
        fetchData();
        fetchStats();
    }
}

function initBottomSheet() {
    if (window.innerWidth > 900 || !dragHandle) return;
    
    let isDragging = false;
    let startY, startHeight;

    dragHandle.addEventListener('touchstart', (e) => {
        isDragging = true;
        startY = e.touches[0].clientY;
        startHeight = bottomSheet.clientHeight;
        bottomSheet.style.transition = 'none'; // Desactivar transición durante el arrastre
    });

    // Añade el listner en document para no perder el rastro si movemos el tactil fuera del handler
    document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        
        const currentY = e.touches[0].clientY;
        const deltaY = startY - currentY; // Positivo si arrastra hacia arriba
        let newHeight = startHeight + deltaY;
        
        const windowHeight = window.innerHeight;
        const minHeight = windowHeight * 0.15; // 15% minimo
        const maxHeight = windowHeight * 0.85; // 85% maximo
        
        if (newHeight < minHeight) newHeight = minHeight;
        if (newHeight > maxHeight) newHeight = maxHeight;
        
        bottomSheet.style.height = `${newHeight}px`;
    });

    document.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        
        bottomSheet.style.transition = 'height 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        
        // Puntos de anclaje magnetico
        const currentHeight = bottomSheet.clientHeight;
        const windowHeight = window.innerHeight;
        const percentage = currentHeight / windowHeight;
        
        if (percentage < 0.35) {
            bottomSheet.style.height = '15vh'; // Minimizado
        } else if (percentage < 0.70) {
            bottomSheet.style.height = '50vh'; // Mitad (por defecto)
        } else {
            bottomSheet.style.height = '85vh'; // Extendido full
        }
    });
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    htmlEl.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const currentTheme = htmlEl.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    htmlEl.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
    
    if(map) {
        map.removeLayer(currentTileLayer);
        currentTileLayer = newTheme === 'dark' ? layers.dark : layers.light;
        currentTileLayer.addTo(map);
    }
}

function updateThemeIcon(theme) {
    const icon = themeToggle.querySelector('i');
    if (theme === 'dark') {
        icon.className = 'fa-solid fa-sun';
    } else {
        icon.className = 'fa-solid fa-moon';
    }
}

function initMap() {
    map = L.map('map', { zoomControl: false }).setView([40.4168, -3.7038], 6);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    layers.dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO', subdomains: 'abcd', maxZoom: 20
    });
    layers.light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO', subdomains: 'abcd', maxZoom: 20
    });

    const isDark = htmlEl.getAttribute('data-theme') !== 'light';
    currentTileLayer = isDark ? layers.dark : layers.light;
    currentTileLayer.addTo(map);

    marcadoresCluster.addTo(map);
}

async function fetchData() {
    try {
        updateTimeEl.textContent = "Actualizando...";
        let url = '/api/averias';
        if (selectedTerritorio) {
            url += `?territorio=${encodeURIComponent(selectedTerritorio)}`;
        }
        const response = await fetch(url);
        averias = await response.json();
        
        const now = new Date();
        updateTimeEl.textContent = `Actualizado: ${now.toLocaleTimeString()}`;
        renderMapAndList();
    } catch (e) {
        updateTimeEl.textContent = "Error al actualizar";
    }
}

async function fetchStats() {
    try {
        let url = '/api/stats';
        if (selectedTerritorio) {
            url += `?territorio=${encodeURIComponent(selectedTerritorio)}`;
        }
        const response = await fetch(url);
        const stats = await response.json();
        renderStats(stats);
    } catch (e) {}
}

function renderStats(stats) {
    statsTerritorios.innerHTML = '';
    statsMunicipios.innerHTML = '';

    // Update section headings dynamically
    const territorioHeading = document.getElementById('statsTerritoriosHeading');
    const municipioHeading = document.getElementById('statsMunicipiosHeading');
    
    if (selectedTerritorio) {
        if (territorioHeading) territorioHeading.textContent = selectedTerritorio;
        if (municipioHeading) municipioHeading.textContent = `Poblaciones · ${selectedTerritorio}`;
    } else {
        if (territorioHeading) territorioHeading.textContent = 'Comunidades/Provincias';
        if (municipioHeading) municipioHeading.textContent = 'Poblaciones Afectadas';
    }

    stats.territorios.forEach(stat => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${stat.territorio || 'N/A'}</span> <span>${stat.total}</span>`;
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => {
            // Clear any population search to zoom back out to the full community
            searchInput.value = '';
            shouldFitBounds = true;
            renderMapAndList();
        });
        statsTerritorios.appendChild(li);
    });

    stats.municipios.forEach(stat => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${stat.municipio || 'N/A'}</span> <span>${stat.total}</span>`;
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => {
            searchInput.value = stat.municipio;
            shouldFitBounds = true;
            if(window.innerWidth <= 900) {
                document.querySelector('.nav-btn[data-target="right-panel"]').click();
                if(bottomSheet) bottomSheet.style.height = '50vh';
            }
            renderMapAndList();
        });
        statsMunicipios.appendChild(li);
    });
}

function isAveriaActiva(averia) {
    if (!averia.fin_previsto) return false;
    const captureDate = new Date(averia.fecha_captura);
    const diffHours = (new Date() - captureDate) / 1000 / 60 / 60;
    return diffHours < 48;
}

function renderMapAndList() {
    const term = searchInput.value.toLowerCase();
    const filtradas = averias.filter(a => {
        const match = (a.municipio && a.municipio.toLowerCase().includes(term)) || 
                      (a.territorio && a.territorio.toLowerCase().includes(term));
        return match;
    });
    
    totalAveriasEl.textContent = `${filtradas.length} eventos`;
    marcadoresCluster.clearLayers();
    eventsList.innerHTML = '';
    
    if (filtradas.length === 0) {
        eventsList.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);">No hay averías registradas.</div>';
        return;
    }

    const bounds = [];
    let delay = 0;

    filtradas.forEach((averia, index) => {
        const activa = isAveriaActiva(averia);
        
        if (averia.latitud && averia.longitud) {
            const marker = L.marker([averia.latitud, averia.longitud], { icon: activa ? dangerIcon : warnIcon });
            marker.bindPopup(`
                <h3>${averia.municipio || 'Incidencia'}</h3>
                ${averia.territorio ? `<p><strong>Territorio:</strong> ${averia.territorio}</p>` : ''}
                ${averia.referencia ? `<p><strong>Ref:</strong> ${averia.referencia}</p>` : ''}
                <p><strong>Afectados:</strong> ${averia.clientes_afectados || 'Desconocido'}</p>
                <p><strong>Causa:</strong> ${averia.causa || '-'}</p>
                <p><strong>Inicio:</strong> ${averia.inicio || 'N/A'}</p>
                <p><strong>Previsto fin:</strong> ${averia.fin_previsto || 'N/A'}</p>
                ${averia.actualizacion ? `<p><strong>Info actualizada:</strong> ${averia.actualizacion}</p>` : ''}
                ${averia.nota ? `<hr style="border-top:1px solid var(--glass-border); margin: 5px 0;"><p style="font-size:0.8rem; font-style:italic; color: var(--accent);"><i class="fa-solid fa-circle-info"></i> ${averia.nota}</p>` : ''}
            `);
            marcadoresCluster.addLayer(marker);
            bounds.push([averia.latitud, averia.longitud]);
            averia._marker = marker;
        }

        if (index < 50) {
            const card = document.createElement('div');
            card.className = `event-card fade-in ${activa ? 'active-event' : ''}`;
            card.style.animationDelay = `${delay}s`; delay += 0.05;

            card.innerHTML = `
                <div class="event-header">
                    <span class="event-title">${averia.municipio || 'Desconocido'}</span>
                    <span class="status-tag ${activa ? 'active' : 'resolved'}">${activa ? 'Activo' : 'Histórico'}</span>
                </div>
                <div class="event-time" title="Última actualización / Captura"><i class="fa-regular fa-clock"></i> ${averia.actualizacion || averia.fecha_captura}</div>
                <div class="event-details" style="margin-top: 5px;">
                    ${averia.referencia ? `<div><strong>Ref:</strong> ${averia.referencia}</div>` : ''}
                    <div style="margin-top:2px;"><strong>Afectados:</strong> ${averia.clientes_afectados || 'N/A'}</div>
                    <div style="margin-top:2px;"><strong>Causa:</strong> ${averia.causa || '-'}</div>
                    <div style="margin-top:2px;"><strong>Inicio:</strong> ${averia.inicio || 'N/A'}</div>
                    <div style="margin-top:2px;"><strong>Previsto fin:</strong> ${averia.fin_previsto || 'N/A'}</div>
                    ${averia.actualizacion ? `<div style="margin-top:2px;"><strong>Info actualizada:</strong> ${averia.actualizacion}</div>` : ''}
                    ${averia.nota ? `<div style="margin-top:6px; font-size: 0.75rem; font-style: italic; color: var(--accent); padding-left: 5px; border-left: 2px solid var(--accent);"><i class="fa-solid fa-circle-info"></i> ${averia.nota}</div>` : ''}
                </div>
                <div class="event-footer">
                    <span>${averia.territorio || ''}</span>
                    <span><i class="fa-solid fa-calendar-check"></i> ${averia.fin_previsto ? averia.fin_previsto.substring(0,10) : ''}</span>
                </div>
            `;

            card.addEventListener('click', () => {
                if (averia.latitud && averia.longitud) {
                    map.flyTo([averia.latitud, averia.longitud], 12, { animate: true, duration: 1.5 });
                    if (averia._marker) setTimeout(() => averia._marker.openPopup(), 1500);
                    // Minimizar el panel en mobil al seleccionar un evento para ver mejor el mapa
                    if(window.innerWidth <= 900 && bottomSheet) bottomSheet.style.height = '15vh';
                }
            });
            eventsList.appendChild(card);
        }
    });

    // Auto-fit map to bounds only when territory or search changes (not on auto-refresh)
    if (bounds.length > 0 && shouldFitBounds) {
         map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 });
         shouldFitBounds = false;
    }
}

// --- NOTIFICATION HISTORY ---
async function loadNotifHistory() {
    const historyList = document.getElementById('notifHistoryList');
    historyList.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando historial...</div>';

    try {
        // Try to filter by current push subscription endpoint
        let url = '/api/push/history';
        if (window.swRegistration) {
            const sub = await window.swRegistration.pushManager.getSubscription();
            if (sub) {
                url += `?endpoint=${encodeURIComponent(sub.endpoint)}`;
            }
        }

        const resp = await fetch(url);
        const history = await resp.json();

        if (history.length === 0) {
            historyList.innerHTML = `
                <div style="text-align:center; padding:40px; color:var(--text-muted);">
                    <i class="fa-solid fa-bell-slash" style="font-size:2.5rem; opacity:0.2; display:block; margin-bottom:12px;"></i>
                    <div style="font-size:0.95rem; margin-bottom:6px;">No hay alertas enviadas aún</div>
                    <div style="font-size:0.8rem; opacity:0.7;">Cuando se detecte una avería en tus poblaciones,<br>aparecerá aquí.</div>
                </div>`;
            return;
        }

        historyList.innerHTML = '';

        // Group by date
        let currentDate = '';
        history.forEach((item, idx) => {
            const sentDate = item.sent_at ? item.sent_at.substring(0, 10) : 'Fecha desconocida';
            if (sentDate !== currentDate) {
                currentDate = sentDate;
                const dateHeader = document.createElement('div');
                dateHeader.className = 'notif-history-date';
                // Format the date nicely
                const d = new Date(sentDate + 'T00:00:00');
                const today = new Date();
                today.setHours(0,0,0,0);
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                let label;
                if (d.getTime() === today.getTime()) {
                    label = 'Hoy';
                } else if (d.getTime() === yesterday.getTime()) {
                    label = 'Ayer';
                } else {
                    label = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
                }
                dateHeader.textContent = label;
                historyList.appendChild(dateHeader);
            }

            const card = document.createElement('div');
            card.className = 'notif-history-card fade-in';
            card.style.animationDelay = `${idx * 0.04}s`;

            const time = item.sent_at ? item.sent_at.substring(11, 16) : '--:--';

            card.innerHTML = `
                <div class="nhc-header">
                    <span class="nhc-municipio"><i class="fa-solid fa-location-dot"></i> ${item.municipio || 'Desconocido'}</span>
                    <span class="nhc-time"><i class="fa-regular fa-clock"></i> ${time}</span>
                </div>
                <div class="nhc-body">
                    ${item.causa ? `<span class="nhc-tag"><i class="fa-solid fa-bolt"></i> ${item.causa}</span>` : ''}
                    ${item.clientes_afectados ? `<span class="nhc-tag"><i class="fa-solid fa-users"></i> ${item.clientes_afectados} afectados</span>` : ''}
                    ${item.territorio ? `<span class="nhc-tag muted"><i class="fa-solid fa-map"></i> ${item.territorio}</span>` : ''}
                </div>
                ${item.referencia ? `<div class="nhc-ref">Ref: ${item.referencia}</div>` : ''}
            `;

            // Click to fly to the location on the map
            if (item.latitud && item.longitud) {
                card.style.cursor = 'pointer';
                card.addEventListener('click', () => {
                    notifModal.classList.add('hidden');
                    map.flyTo([item.latitud, item.longitud], 13, { animate: true, duration: 1.5 });
                });
            }

            historyList.appendChild(card);
        });

    } catch (e) {
        console.error('Error loading notification history:', e);
        historyList.innerHTML = '<div style="text-align:center;padding:30px;color:var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Error al cargar el historial</div>';
    }
}
