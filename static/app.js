/* ═══════════════════════════════════════════════════════════
   app.js — Frontend Logic for Fichaje Fotográfico
   AFA Somos Todos 2026
   ═══════════════════════════════════════════════════════════ */

// ─── State ───────────────────────────────────────────────
let userName = localStorage.getItem('fichaje_user') || '';
let currentView = 'dashboard';
let currentTeamId = null;
let currentTeamName = '';
let currentFilter = 'all';
let fichajeQueue = [];
let fichajeIndex = 0;
let capturedImageData = null;
let cameraStream = null;
let eventSource = null;

const API = '';

// ─── Init ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (userName) {
        hideUserModal();
        connectSSE();
        loadDashboard();
    }
    document.getElementById('userNameInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') setUserName();
    });
});

function setUserName() {
    const input = document.getElementById('userNameInput');
    const name = input.value.trim();
    if (!name) return;
    userName = name;
    localStorage.setItem('fichaje_user', name);
    hideUserModal();
    connectSSE();
    loadDashboard();
}

function hideUserModal() {
    document.getElementById('userModal').style.display = 'none';
    document.getElementById('userBadge').style.display = 'flex';
    document.getElementById('userNameDisplay').textContent = userName;
}

// ─── Polling (replaces SSE for Vercel serverless) ────────
let pollInterval = null;

function connectSSE() {
    // Vercel serverless doesn't support SSE, use polling instead
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => {
        refreshCurrentView();
    }, 15000); // Poll every 15 seconds
}

// ─── Navigation ──────────────────────────────────────────
function navigate(view, data) {
    // Stop camera if leaving fichaje
    if (currentView === 'fichaje' && view !== 'fichaje') stopCamera();

    currentView = view;
    document.querySelectorAll('#app > section').forEach(s => s.style.display = 'none');

    // Update both desktop tabs and bottom nav
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.bottom-nav-item').forEach(t => t.classList.remove('active'));

    const mappedView = (view === 'team') ? 'teams' : view;
    const tab = document.querySelector(`.nav-tab[data-view="${mappedView}"]`);
    if (tab) tab.classList.add('active');
    const bottomTab = document.querySelector(`.bottom-nav-item[data-view="${mappedView}"]`);
    if (bottomTab) bottomTab.classList.add('active');

    // Scroll to top on mobile
    window.scrollTo({ top: 0, behavior: 'smooth' });

    switch (view) {
        case 'dashboard':
            document.getElementById('view-dashboard').style.display = '';
            loadDashboard();
            break;
        case 'teams':
            document.getElementById('view-dashboard').style.display = '';
            loadDashboard();
            break;
        case 'team':
            document.getElementById('view-team').style.display = '';
            if (data) { currentTeamId = data.id; currentTeamName = data.name; }
            loadTeamPlayers();
            break;
        case 'fichaje':
            document.getElementById('view-fichaje').style.display = '';
            if (data && data.teamId) {
                startFichaje(data.teamId, data.teamName);
            } else {
                showFichajeSelector();
            }
            break;
        case 'activity':
            document.getElementById('view-activity').style.display = '';
            loadActivity();
            break;
    }
}

function refreshCurrentView() {
    if (currentView === 'dashboard' || currentView === 'teams') loadDashboard();
    else if (currentView === 'team') loadTeamPlayers();
}

// ─── Dashboard ───────────────────────────────────────────
async function loadDashboard() {
    try {
        const [stats, teams] = await Promise.all([
            fetch(`${API}/api/stats`).then(r => r.json()),
            fetch(`${API}/api/teams`).then(r => r.json())
        ]);
        renderStats(stats);
        renderTeams(teams);
    } catch (e) {
        console.error('Error loading dashboard:', e);
    }
}

function renderStats(s) {
    document.getElementById('statsGrid').innerHTML = `
        <div class="stat-card">
            <div class="label">Total Jugadores</div>
            <div class="value gradient">${s.total_players}</div>
        </div>
        <div class="stat-card">
            <div class="label">Fotos OK</div>
            <div class="value success">${s.photos_done}</div>
            <div class="progress-bar"><div class="fill" style="width:${s.progress_pct}%"></div></div>
        </div>
        <div class="stat-card">
            <div class="label">Sin Foto / Malas</div>
            <div class="value danger">${s.photos_remaining}</div>
        </div>
        <div class="stat-card">
            <div class="label">En Revisión</div>
            <div class="value warning">${s.photos_in_review}</div>
        </div>
    `;
}

function renderTeams(teams) {
    const grid = document.getElementById('teamsGrid');
    grid.innerHTML = teams.map(t => {
        const total = t.total_players || 1;
        const pct = Math.round(((t.photos_ok || 0) / total) * 100);
        return `
        <div class="team-card" onclick="navigate('team', {id:${t.id}, name:'${esc(t.name)}'})">
            <div class="team-name">${esc(t.name)}</div>
            <div class="team-stats">
                <span>👥 ${t.total_players}</span>
                <span class="badge badge-ok">✓ ${t.photos_ok || 0}</span>
                <span class="badge badge-missing">⊘ ${t.photos_missing || 0}</span>
                <span class="badge badge-pending">⏳ ${t.photos_pending || 0}</span>
            </div>
            <div class="progress-bar" style="margin-top:0.75rem"><div class="fill" style="width:${pct}%"></div></div>
        </div>`;
    }).join('');
}

// ─── Team Players ────────────────────────────────────────
async function loadTeamPlayers() {
    document.getElementById('teamTitle').textContent = currentTeamName;
    const statusParam = currentFilter === 'all' ? '' : `&status=${currentFilter}`;
    try {
        const players = await fetch(`${API}/api/players?team_id=${currentTeamId}${statusParam}`).then(r => r.json());
        renderPlayers(players);
    } catch (e) {
        console.error('Error loading players:', e);
    }
}

function filterPlayers(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.filter-btn[data-filter="${filter}"]`).classList.add('active');
    loadTeamPlayers();
}

function renderPlayers(players) {
    const grid = document.getElementById('playersGrid');
    if (!players.length) {
        grid.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>No hay jugadores con este filtro</p></div>`;
        return;
    }
    grid.innerHTML = players.map(p => `
        <div class="player-card" onclick="openPlayerFichaje(${p.id}, ${currentTeamId}, '${esc(currentTeamName)}')">
            <div class="player-avatar status-${p.photo_status}">
                ${p.photo_status !== 'missing' ? `<img src="${API}/api/player/${p.id}/thumbnail" alt="">` : '👤'}
            </div>
            <div class="player-info">
                <div class="name">${esc(p.name || '')} ${esc(p.surname || '')}</div>
                <div class="dni">${p.dni ? 'DNI: ' + esc(p.dni) : 'Sin DNI'}</div>
            </div>
            <span class="badge badge-${p.photo_status === 'new' ? 'pending' : p.photo_status}">${statusLabel(p.photo_status)}</span>
        </div>
    `).join('');
}

function statusLabel(s) {
    const map = { ok: '✓ OK', bad: '✗ Mala', missing: '⊘ Falta', pending_review: '⏳ Revisar', new: '🆕 Nueva' };
    return map[s] || s;
}

// ─── Fichaje ─────────────────────────────────────────────
async function showFichajeSelector() {
    document.getElementById('fichajeSelector').style.display = '';
    document.getElementById('fichajeContent').style.display = 'none';
    document.getElementById('fichajeTitle').textContent = 'Seleccionar Equipo';
    try {
        const teams = await fetch(`${API}/api/teams`).then(r => r.json());
        const grid = document.getElementById('fichajeTeamsGrid');
        grid.innerHTML = teams.filter(t => (t.photos_missing || 0) + (t.photos_bad || 0) > 0).map(t => `
            <div class="team-card" onclick="startFichaje(${t.id}, '${esc(t.name)}')">
                <div class="team-name">${esc(t.name)}</div>
                <div class="team-stats">
                    <span class="badge badge-missing">⊘ ${t.photos_missing || 0} faltan</span>
                    <span class="badge badge-bad">✗ ${t.photos_bad || 0} malas</span>
                </div>
            </div>
        `).join('');
        if (!grid.innerHTML) {
            grid.innerHTML = `<div class="empty-state"><div class="icon">🎉</div><p>¡Todos los equipos tienen fotos!</p></div>`;
        }
    } catch (e) {
        console.error('Error loading teams for fichaje:', e);
    }
}

async function startFichaje(teamId, teamName) {
    currentTeamId = teamId;
    currentTeamName = teamName;
    document.getElementById('fichajeSelector').style.display = 'none';
    document.getElementById('fichajeContent').style.display = '';
    document.getElementById('fichajeTitle').textContent = `Fichaje — ${teamName}`;

    // Load players needing photos
    try {
        fichajeQueue = await fetch(`${API}/api/players?team_id=${teamId}&status=needs_work`).then(r => r.json());
        fichajeIndex = 0;
        if (fichajeQueue.length === 0) {
            showToast('¡Este equipo tiene todas las fotos!', 'success');
            showFichajeSelector();
            return;
        }
        await startCamera();
        loadFichajePlayer();
    } catch (e) {
        console.error('Error starting fichaje:', e);
    }
}

function openPlayerFichaje(playerId, teamId, teamName) {
    navigate('fichaje', { teamId, teamName });
    // After loading, find the player in the queue
    setTimeout(() => {
        const idx = fichajeQueue.findIndex(p => p.id === playerId);
        if (idx >= 0) { fichajeIndex = idx; loadFichajePlayer(); }
    }, 500);
}

function loadFichajePlayer() {
    if (fichajeIndex >= fichajeQueue.length) {
        showToast('¡Fichaje completo para este equipo!', 'success');
        showFichajeSelector();
        return;
    }
    const p = fichajeQueue[fichajeIndex];
    document.getElementById('queueInfo').textContent = `Jugador ${fichajeIndex + 1} de ${fichajeQueue.length}`;

    const detail = document.getElementById('playerDetail');
    detail.innerHTML = `
        <div class="detail-header">
            <div class="detail-avatar status-${p.photo_status}" id="detailAvatar">
                ${p.photo_status !== 'missing' ? `<img src="${API}/api/player/${p.id}/thumbnail" alt="">` : '👤'}
            </div>
            <div>
                <div class="detail-name">${esc(p.name || '')} ${esc(p.surname || '')}</div>
                <div class="detail-team">${esc(currentTeamName)}</div>
            </div>
        </div>
        <div class="detail-fields">
            <div class="detail-field">
                <div class="field-label">DNI</div>
                <div class="field-value">${p.dni || '—'}</div>
            </div>
            <div class="detail-field">
                <div class="field-label">Estado</div>
                <div class="field-value"><span class="badge badge-${p.photo_status === 'new' ? 'pending' : p.photo_status}">${statusLabel(p.photo_status)}</span></div>
            </div>
            <div class="detail-field">
                <div class="field-label">Email</div>
                <div class="field-value">${p.email || '—'}</div>
            </div>
            <div class="detail-field">
                <div class="field-label">Fila Excel</div>
                <div class="field-value">${p.excel_row}</div>
            </div>
        </div>
        ${p.photo_status !== 'missing' ? `
        <div class="review-actions">
            <button class="btn btn-success" onclick="reviewPhoto(${p.id}, 'ok')" style="flex:1">✓ Aprobar Foto</button>
            <button class="btn btn-danger" onclick="reviewPhoto(${p.id}, 'bad')" style="flex:1">✗ Rechazar</button>
        </div>` : ''}
    `;

    // Reset camera UI
    resetCameraUI();
}

function skipToNext() {
    fichajeIndex++;
    loadFichajePlayer();
}

function exitFichaje() {
    stopCamera();
    if (currentTeamId) {
        navigate('team', { id: currentTeamId, name: currentTeamName });
    } else {
        navigate('dashboard');
    }
}

// ─── Camera ──────────────────────────────────────────────
async function startCamera() {
    try {
        // Use front camera for fichaje (selfie style on mobile)
        const isMobile = window.innerWidth <= 640;
        const constraints = {
            video: {
                facingMode: isMobile ? 'user' : 'environment',
                width: { ideal: 720 },
                height: { ideal: 960 }
            }
        };
        cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
        const video = document.getElementById('cameraVideo');
        video.srcObject = cameraStream;
        video.style.display = '';
        document.getElementById('cameraCanvas').style.display = 'none';
        document.getElementById('cameraGuide').style.display = '';
    } catch (e) {
        console.error('Camera error:', e);
        showToast('Error al acceder a la cámara: ' + e.message, 'error');
    }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
}

function capturePhoto() {
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('cameraCanvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    capturedImageData = canvas.toDataURL('image/jpeg', 0.9);

    // Show preview
    video.style.display = 'none';
    canvas.style.display = '';
    document.getElementById('cameraGuide').style.display = 'none';

    // Toggle buttons
    document.getElementById('btnCapture').style.display = 'none';
    document.getElementById('btnRetake').style.display = '';
    document.getElementById('btnSave').style.display = '';
}

function retakePhoto() {
    capturedImageData = null;
    resetCameraUI();
}

function resetCameraUI() {
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('cameraCanvas');
    video.style.display = '';
    canvas.style.display = 'none';
    document.getElementById('cameraGuide').style.display = '';
    document.getElementById('btnCapture').style.display = '';
    document.getElementById('btnRetake').style.display = 'none';
    document.getElementById('btnSave').style.display = 'none';
    capturedImageData = null;
}

async function savePhoto() {
    if (!capturedImageData || fichajeIndex >= fichajeQueue.length) return;
    const player = fichajeQueue[fichajeIndex];

    document.getElementById('btnSave').disabled = true;
    document.getElementById('btnSave').textContent = '⏳ Guardando...';

    try {
        const res = await fetch(`${API}/api/player/${player.id}/photo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: capturedImageData, user_name: userName })
        });
        const data = await res.json();

        if (data.success) {
            showToast(`✓ Foto guardada para ${player.name} ${player.surname}`, 'success');
            // Update local state
            fichajeQueue[fichajeIndex].photo_status = 'pending_review';
            // Move to next
            fichajeIndex++;
            loadFichajePlayer();
        } else {
            showToast('Error: ' + (data.error || 'Unknown'), 'error');
        }
    } catch (e) {
        showToast('Error de red: ' + e.message, 'error');
    }

    document.getElementById('btnSave').disabled = false;
    document.getElementById('btnSave').textContent = '✓ Guardar';
}

async function reviewPhoto(playerId, status) {
    try {
        const res = await fetch(`${API}/api/player/${playerId}/review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, user_name: userName })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`Foto marcada como ${status === 'ok' ? 'OK ✓' : 'Mala ✗'}`, status === 'ok' ? 'success' : 'error');
            if (currentView === 'fichaje') {
                fichajeQueue[fichajeIndex].photo_status = status;
                if (status === 'bad') {
                    // Stay on same player to retake
                    loadFichajePlayer();
                } else {
                    fichajeIndex++;
                    loadFichajePlayer();
                }
            } else {
                loadTeamPlayers();
            }
        }
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

// ─── Export ──────────────────────────────────────────────
function exportTeam() {
    if (!currentTeamId) return;
    window.open(`${API}/api/export/${currentTeamId}`, '_blank');
    showToast('Exportando Excel...', 'info');
}

// ─── Activity ────────────────────────────────────────────
async function loadActivity() {
    try {
        const entries = await fetch(`${API}/api/activity?limit=50`).then(r => r.json());
        const list = document.getElementById('activityList');
        if (!entries.length) {
            list.innerHTML = '<div class="empty-state"><p>Sin actividad todavía</p></div>';
            return;
        }
        list.innerHTML = entries.map(e => {
            const time = new Date(e.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
            return `<div class="activity-item">
                <span class="time">${time}</span>
                <span class="text"><strong>${esc(e.user_name || 'Sistema')}</strong> — ${esc(e.details || e.action)}</span>
            </div>`;
        }).join('');
    } catch (e) {
        console.error('Error loading activity:', e);
    }
}

// ─── Toast ───────────────────────────────────────────────
function showToast(message, type = 'info') {
    const container = document.getElementById('toasts');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
}

// ─── Utils ───────────────────────────────────────────────
function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}
