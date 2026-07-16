// Frontend Logic for Leave Management System

const API_BASE = '/api';
let currentUser = null;
let allLeaves = [];
let monthlyChart = null;
let deptChart = null;

// Calendar State
let currentCalendarDate = new Date();
const THAI_MONTHS = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

// On Page Load
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    
    // Check Auth State via Signed Token
    const savedToken = localStorage.getItem('authToken');
    if (savedToken) {
        navigateTo('dashboard');
    } else {
        navigateTo('landing');
    }
    
    // Set default dates for leave forms to today and tomorrow
    const today = new Date().toISOString().split('T')[0];
    const tomorrowObj = new Date();
    tomorrowObj.setDate(tomorrowObj.getDate() + 1);
    const tomorrow = tomorrowObj.toISOString().split('T')[0];
    
    const quickStart = document.getElementById('quick-start-date');
    const quickEnd = document.getElementById('quick-end-date');
    const fullStart = document.getElementById('full-start-date');
    const fullEnd = document.getElementById('full-end-date');
    
    if (quickStart) quickStart.value = today;
    if (quickEnd) quickEnd.value = today;
    if (fullStart) fullStart.value = today;
    if (fullEnd) fullEnd.value = tomorrow;
});

// Toast Notifications Helper
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconName = 'check-circle';
    if (type === 'danger') iconName = 'x-circle';
    if (type === 'warning') iconName = 'alert-triangle';
    
    toast.innerHTML = `
        <i data-lucide="${iconName}" class="toast-icon"></i>
        <div class="toast-content">${message}</div>
    `;
    
    container.appendChild(toast);
    lucide.createIcons();
    
    setTimeout(() => toast.classList.add('show'), 50);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// Navigation Router
function navigateTo(viewId) {
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    
    const targetView = document.getElementById(`view-${viewId}`);
    if (targetView) {
        targetView.classList.add('active');
    }
    
    if (viewId === 'dashboard') {
        fetchProfile();
    } else {
        currentUser = null;
        localStorage.removeItem('authToken');
        localStorage.removeItem('userId');
    }
}

// Sidebar Tab Switcher
function switchTab(tabId) {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelectorAll('.dashboard-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    const navItem = document.getElementById(`nav-${tabId}`);
    const tabItem = document.getElementById(`tab-${tabId}`);
    
    if (navItem) navItem.classList.add('active');
    if (tabItem) tabItem.classList.add('active');
    
    const title = document.getElementById('current-tab-title');
    const subtitle = document.getElementById('current-tab-subtitle');
    
    if (tabId === 'home') {
        title.innerText = 'แดชบอร์ด';
        subtitle.innerText = 'ภาพรวมการลางานของคุณ';
        fetchProfile();
    } else if (tabId === 'submit') {
        title.innerText = 'ยื่นใบลา';
        subtitle.innerText = 'กรอกข้อมูลยื่นคำขอลางาน';
        updateEntitlementsFormView();
    } else if (tabId === 'history') {
        title.innerText = 'ประวัติการลา';
        subtitle.innerText = 'ประวัติการทำรายการลางานทั้งหมดของคุณ';
        fetchLeaves();
    } else if (tabId === 'calendar') {
        title.innerText = 'ปฏิทินการลา';
        subtitle.innerText = 'ตารางแสดงการลางานของเพื่อนพนักงานในทีม';
        renderCalendar();
    } else if (tabId === 'manager') {
        title.innerText = 'อนุมัติใบลา';
        subtitle.innerText = 'รายการคำขอลางานของทีมที่รอการตรวจสอบ';
        fetchLeaves();
    } else if (tabId === 'hr') {
        title.innerText = 'แดชบอร์ดสรุปการลา';
        subtitle.innerText = 'สถิติข้อมูลและการวิเคราะห์การลาในองค์กร';
        renderCharts();
    }
    
    document.getElementById('notification-dropdown').classList.remove('active');
}

// Fetch Profile Details
async function fetchProfile() {
    const token = localStorage.getItem('authToken');
    if (!token) return navigateTo('login');
    
    try {
        const response = await fetch(`${API_BASE}/profile`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        
        if (response.status === 401) {
            showToast("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่", "danger");
            return navigateTo('login');
        }
        
        currentUser = await response.json();
        
        document.getElementById('profile-name').innerText = currentUser.name;
        document.getElementById('user-avatar-initial').innerText = currentUser.name.charAt(0);
        
        let roleText = 'พนักงาน';
        if (currentUser.role === 'manager') roleText = `หัวหน้างาน (${currentUser.department})`;
        if (currentUser.role === 'hr') roleText = 'HR / ผู้ดูแลระบบ';
        document.getElementById('profile-role').innerText = roleText;
        
        const managerNav = document.getElementById('nav-manager');
        const hrNav = document.getElementById('nav-hr');
        
        if (currentUser.role === 'manager' || currentUser.role === 'hr') {
            managerNav.style.display = 'flex';
        } else {
            managerNav.style.display = 'none';
        }
        
        if (currentUser.role === 'hr') {
            hrNav.style.display = 'flex';
        } else {
            hrNav.style.display = 'none';
        }
        
        updateHomeStats();
        fetchLeaves();
        
    } catch (error) {
        console.error("Profile fetch error:", error);
        showToast("ไม่สามารถดึงข้อมูลโปรไฟล์ได้", "danger");
    }
}

// Update stats numbers on Home Tab
function updateHomeStats() {
    if (!currentUser || !currentUser.leave_balances) return;
    const bal = currentUser.leave_balances;
    
    const totalRemaining = bal.sick.remaining + bal.personal.remaining + bal.vacation.remaining;
    document.getElementById('stat-total-remaining').innerText = totalRemaining.toFixed(1).replace('.0', '');
    
    const totalUsed = bal.sick.used + bal.personal.used + bal.vacation.used;
    document.getElementById('stat-total-used').innerText = totalUsed.toFixed(1).replace('.0', '');
    
    document.getElementById('stat-sick-used').innerText = `${bal.sick.used.toFixed(1).replace('.0', '')} / ${bal.sick.limit} วัน`;
}

// Update entitlements preview text inside the full leave form
function updateEntitlementsFormView() {
    if (!currentUser || !currentUser.leave_balances) return;
    const bal = currentUser.leave_balances;
    document.getElementById('mini-sick-remaining').innerText = `${bal.sick.remaining.toFixed(1).replace('.0', '')} วัน`;
    document.getElementById('mini-personal-remaining').innerText = `${bal.personal.remaining.toFixed(1).replace('.0', '')} วัน`;
    document.getElementById('mini-vacation-remaining').innerText = `${bal.vacation.remaining.toFixed(1).replace('.0', '')} วัน`;
}

// Fetch Leave Logs
async function fetchLeaves() {
    const token = localStorage.getItem('authToken');
    if (!token) return;
    
    try {
        const response = await fetch(`${API_BASE}/leaves`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        
        allLeaves = await response.json();
        
        // Update Pending count
        const pendingLeaves = allLeaves.filter(l => {
            if (currentUser.role === 'hr') {
                return l.status === 'pending' || l.status === 'pending_hr';
            }
            return l.status === 'pending';
        });
        
        document.getElementById('stat-total-pending').innerText = pendingLeaves.length;
        
        const pendingBadge = document.getElementById('pending-badge-count');
        if (pendingBadge) {
            if (pendingLeaves.length > 0 && (currentUser.role === 'manager' || currentUser.role === 'hr')) {
                pendingBadge.innerText = pendingLeaves.length;
                pendingBadge.style.display = 'inline-flex';
            } else {
                pendingBadge.style.display = 'none';
            }
        }
        
        renderRecentLeavesTable();
        renderHistoryLeavesTable();
        
        if (currentUser.role === 'manager' || currentUser.role === 'hr') {
            renderManagerPendingTable(pendingLeaves);
            renderManagerDepartmentHistoryTable();
        }
        
        setupMockNotifications(pendingLeaves);
        
    } catch (error) {
        console.error("Leaves fetch error:", error);
        showToast("ไม่สามารถดึงข้อมูลการลาได้", "danger");
    }
}

// Setup notifications list based on state
function setupMockNotifications(pendingLeaves) {
    const countEl = document.getElementById('notification-count');
    const listEl = document.getElementById('notification-list');
    
    let notifications = [];
    
    if (currentUser.role === 'manager' || currentUser.role === 'hr') {
        pendingLeaves.forEach(l => {
            const level = l.status === 'pending' ? 'รอหัวหน้างานอนุมัติ' : 'รอ HR อนุมัติ';
            notifications.push({
                title: 'คำขอลางานใหม่',
                text: `${l.employee_name} ขอ${translateLeaveType(l.leave_type)} (${level}) ${l.leave_duration} วัน`,
                time: l.created_at
            });
        });
    }
    
    const myLeaves = allLeaves.filter(l => l.user_id === currentUser.id);
    const recentActions = myLeaves.filter(l => l.status !== 'pending' && l.status !== 'pending_hr');
    recentActions.slice(0, 5).forEach(l => {
        let statusText = '';
        if (l.status === 'approved') statusText = 'ได้รับการอนุมัติขั้นสุดท้ายเรียบร้อยแล้ว ✅';
        else if (l.status === 'rejected') statusText = 'ถูกปฏิเสธ ❌';
        else if (l.status === 'cancelled') statusText = 'ถูกยกเลิกแล้ว';
        
        notifications.push({
            title: `คำขอลางาน ${statusText}`,
            text: `ขอลา ${translateLeaveType(l.leave_type)} วันที่ ${l.start_date} ${l.status === 'rejected' ? 'เนื่องจาก: ' + l.rejection_reason : ''}`,
            time: l.created_at
        });
    });
    
    countEl.innerText = notifications.length;
    if (notifications.length === 0) {
        countEl.style.display = 'none';
        listEl.innerHTML = '<div class="empty-noti">ไม่มีการแจ้งเตือนในขณะนี้</div>';
    } else {
        countEl.style.display = 'flex';
        listEl.innerHTML = notifications.map(n => `
            <div class="noti-item">
                <div class="noti-title">${n.title}</div>
                <div>${n.text}</div>
                <div class="noti-time">${n.time}</div>
            </div>
        `).join('');
    }
}

function toggleNotifications() {
    document.getElementById('notification-dropdown').classList.toggle('active');
}

// Helpers to format strings
function translateLeaveType(type) {
    const map = {
        'sick': 'ลาป่วย',
        'personal': 'ลากิจ',
        'vacation': 'ลาพักร้อน'
    };
    return map[type] || type;
}

function getStatusBadge(status) {
    const map = {
        'pending': '<span class="badge badge-warning">รอหัวหน้าอนุมัติ</span>',
        'pending_hr': '<span class="badge badge-warning">รอ HR อนุมัติ</span>',
        'approved': '<span class="badge badge-success">อนุมัติแล้ว</span>',
        'rejected': '<span class="badge badge-danger">ปฏิเสธแล้ว</span>',
        'cancelled': '<span class="badge badge-danger" style="background-color:#f1f5f9; color:#64748b;">ยกเลิกแล้ว</span>'
    };
    return map[status] || status;
}

// Helper to read file as Base64 Promise
function getBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

// Date Locking logic for Half-day leave
function toggleDateLock(formType) {
    const period = document.getElementById(`${formType}-leave-period`).value;
    const endContainer = document.getElementById(`${formType}-end-date-container`);
    const startVal = document.getElementById(`${formType}-start-date`).value;
    const endInput = document.getElementById(`${formType}-end-date`);
    
    if (period !== 'full') {
        if (endContainer) endContainer.style.display = 'none';
        endInput.value = startVal;
        endInput.removeAttribute('required');
    } else {
        if (endContainer) endContainer.style.display = 'grid';
        endInput.setAttribute('required', 'required');
    }
}

function matchEndDate(formType) {
    const period = document.getElementById(`${formType}-leave-period`).value;
    if (period !== 'full') {
        const startVal = document.getElementById(`${formType}-start-date`).value;
        document.getElementById(`${formType}-end-date`).value = startVal;
    }
}

// Render Recent Leaves Table (Home Tab)
function renderRecentLeavesTable() {
    const tbody = document.querySelector('#table-recent-leaves tbody');
    if (!tbody) return;
    
    const myLeaves = allLeaves.filter(l => l.user_id === currentUser.id);
    const recent = myLeaves.slice(0, 5);
    
    if (recent.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center py-4 text-muted">
                    <div class="empty-state">
                        <i data-lucide="clock" class="empty-icon"></i>
                        <p>ยังไม่มีใบลา<br>เมื่อคุณยื่นใบลา จะแสดงในส่วนนี้</p>
                    </div>
                </td>
            </tr>
        `;
        lucide.createIcons();
        return;
    }
    
    tbody.innerHTML = recent.map(l => `
        <tr>
            <td><strong>${translateLeaveType(l.leave_type)}</strong></td>
            <td>${l.start_date} ${l.start_date !== l.end_date ? ' ถึง ' + l.end_date : ''}</td>
            <td>${l.leave_duration} วัน</td>
            <td>${getStatusBadge(l.status)}</td>
        </tr>
    `).join('');
}

// Render History Leaves Table (History Tab)
function renderHistoryLeavesTable() {
    const tbody = document.querySelector('#table-history-leaves tbody');
    if (!tbody) return;
    
    const typeFilter = document.getElementById('filter-type').value;
    const statusFilter = document.getElementById('filter-status').value;
    
    let filtered = allLeaves.filter(l => l.user_id === currentUser.id);
    
    if (typeFilter !== 'all') {
        filtered = filtered.filter(l => l.leave_type === typeFilter);
    }
    if (statusFilter !== 'all') {
        filtered = filtered.filter(l => l.status === statusFilter);
    }
    
    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center py-4 text-muted">
                    <div class="empty-state">
                        <i data-lucide="folder-open" class="empty-icon"></i>
                        <p>ไม่พบประวัติการลางานตามเงื่อนไขที่เลือก</p>
                    </div>
                </td>
            </tr>
        `;
        lucide.createIcons();
        return;
    }
    
    tbody.innerHTML = filtered.map(l => {
        const reviewer = l.manager_name ? l.manager_name : '';
        const notes = l.status === 'rejected' && l.rejection_reason 
            ? `<div class="text-danger" style="font-size:0.8rem; margin-top:0.25rem;">เหตุผล: ${l.rejection_reason}</div>`
            : '';
            
        const attachment = l.attachment_path 
            ? `<div class="mt-2"><a href="${l.attachment_path}" target="_blank" class="text-primary flex-center gap-1" style="font-size:0.85rem;"><i data-lucide="paperclip" style="width:14px;height:14px;"></i> ${l.attachment_name}</a></div>`
            : '';
            
        const periodText = l.leave_period === 'full' ? 'เต็มวัน' : (l.leave_period === 'morning' ? 'ครึ่งเช้า' : 'ครึ่งบ่าย');
        
        const startDt = new Date(l.start_date);
        const todayDt = new Date();
        todayDt.setHours(0,0,0,0);
        
        let cancelBtn = '';
        if (l.status === 'pending' || l.status === 'pending_hr' || (l.status === 'approved' && startDt > todayDt)) {
            cancelBtn = `<button class="btn btn-secondary btn-icon" onclick="cancelLeave(${l.id})" title="ยกเลิกใบลา"><i data-lucide="trash-2" style="color:var(--danger)"></i></button>`;
        }
        
        return `
            <tr>
                <td>${l.created_at.split(' ')[0]}</td>
                <td><strong>${translateLeaveType(l.leave_type)}</strong></td>
                <td>${periodText}</td>
                <td>${l.start_date} ${l.start_date !== l.end_date ? ' ถึง ' + l.end_date : ''}</td>
                <td>${l.leave_duration} วัน</td>
                <td><div>${l.reason || '-'}</div>${attachment}</td>
                <td>${getStatusBadge(l.status)}</td>
                <td>${reviewer} ${notes}</td>
                <td>${cancelBtn}</td>
            </tr>
        `;
    }).join('');
    lucide.createIcons();
}

function filterLeaveHistory() {
    renderHistoryLeavesTable();
}

// Cancel Leave Request (with Signed Token)
async function cancelLeave(leaveId) {
    if (!confirm("คุณแน่ใจหรือไม่ว่าต้องการยกเลิกคำขอลางานนี้?")) return;
    const token = localStorage.getItem('authToken');
    
    try {
        const response = await fetch(`${API_BASE}/leaves/cancel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ leave_id: leaveId })
        });
        
        const res = await response.json();
        if (response.ok) {
            showToast("ยกเลิกคำขอลางานสำเร็จแล้ว", "success");
            fetchProfile();
        } else {
            showToast(res.error || "ไม่สามารถยกเลิกได้", "danger");
        }
    } catch (e) {
        showToast("เชื่อมต่อระบบขัดข้อง", "danger");
    }
}

// Render Manager Approvals Table
function renderManagerPendingTable(pending) {
    const tbody = document.querySelector('#table-pending-leaves tbody');
    if (!tbody) return;
    
    if (pending.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="text-center py-4 text-muted">
                    <div class="empty-state">
                        <i data-lucide="check-circle" class="empty-icon" style="color:var(--success)"></i>
                        <p>ไม่มีคำขอลางานที่รออนุมัติในระดับสิทธิ์ของคุณ</p>
                    </div>
                </td>
            </tr>
        `;
        lucide.createIcons();
        return;
    }
    
    tbody.innerHTML = pending.map(l => {
        const attachment = l.attachment_path 
            ? `<div class="mt-1"><a href="${l.attachment_path}" target="_blank" class="text-primary flex-center gap-1" style="font-size:0.8rem;"><i data-lucide="paperclip" style="width:14px;height:14px;"></i> ${l.attachment_name}</a></div>`
            : '';
            
        const periodText = l.leave_period === 'full' ? 'เต็มวัน' : (l.leave_period === 'morning' ? 'ครึ่งเช้า' : 'ครึ่งบ่าย');
        
        return `
            <tr>
                <td><strong>${l.employee_name}</strong></td>
                <td>${l.department}</td>
                <td><strong>${translateLeaveType(l.leave_type)}</strong></td>
                <td>${periodText}</td>
                <td>${l.start_date} ${l.start_date !== l.end_date ? ' ถึง ' + l.end_date : ''}</td>
                <td>${l.leave_duration} วัน</td>
                <td><div>${l.reason || '-'}</div>${attachment}</td>
                <td>${l.created_at}</td>
                <td>${getStatusBadge(l.status)}</td>
                <td>
                    <div class="table-actions">
                        <button class="btn-icon btn-icon-success" onclick="approveLeave(${l.id})" title="อนุมัติใบลา">
                            <i data-lucide="check"></i>
                        </button>
                        <button class="btn-icon btn-icon-danger" onclick="openRejectModal(${l.id})" title="ปฏิเสธใบลา">
                            <i data-lucide="x"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    lucide.createIcons();
}

// Render Manager Department History
function renderManagerDepartmentHistoryTable() {
    const tbody = document.querySelector('#table-dept-leaves tbody');
    if (!tbody) return;
    
    const processed = allLeaves.filter(l => l.status !== 'pending' && l.status !== 'pending_hr');
    
    if (processed.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-4 text-muted">ไม่มีประวัติการดำเนินการก่อนหน้านี้</td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = processed.map(l => {
        const periodText = l.leave_period === 'full' ? 'เต็มวัน' : (l.leave_period === 'morning' ? 'ครึ่งเช้า' : 'ครึ่งบ่าย');
        return `
            <tr>
                <td>${l.employee_name} (${l.department})</td>
                <td><strong>${translateLeaveType(l.leave_type)}</strong></td>
                <td>${periodText}</td>
                <td>${l.start_date} ${l.start_date !== l.end_date ? ' ถึง ' + l.end_date : ''}</td>
                <td>${l.leave_duration} วัน</td>
                <td>${getStatusBadge(l.status)}</td>
                <td>${l.manager_name || '-'}</td>
                <td><span style="font-size:0.85rem">${l.rejection_reason || '-'}</span></td>
            </tr>
        `;
    }).join('');
}

// Approve / Reject Actions (with Signed Token)
async function approveLeave(leaveId) {
    const token = localStorage.getItem('authToken');
    if (!confirm("คุณต้องการอนุมัติคำขอลางานนี้ใช่หรือไม่?")) return;
    
    try {
        const response = await fetch(`${API_BASE}/leaves/action`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ leave_id: leaveId, status: 'approved' })
        });
        
        const res = await response.json();
        if (response.ok) {
            showToast("ดำเนินการบันทึกการอนุมัติสำเร็จแล้ว", "success");
            fetchLeaves();
        } else {
            showToast(res.error || "เกิดข้อผิดพลาดในการดำเนินรายการ", "danger");
        }
    } catch (e) {
        showToast("เชื่อมต่อเซิร์ฟเวอร์ล้มเหลว", "danger");
    }
}

function openRejectModal(leaveId) {
    document.getElementById('reject-leave-id').value = leaveId;
    document.getElementById('reject-reason-text').value = '';
    document.getElementById('reject-modal').classList.add('active');
}

function closeRejectModal() {
    document.getElementById('reject-modal').classList.remove('active');
}

async function submitRejection() {
    const leaveId = document.getElementById('reject-leave-id').value;
    const reason = document.getElementById('reject-reason-text').value.trim();
    const token = localStorage.getItem('authToken');
    
    if (!reason) {
        return showToast("กรุณากรอกเหตุผลการปฏิเสธใบลา", "warning");
    }
    
    try {
        const response = await fetch(`${API_BASE}/leaves/action`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                leave_id: leaveId,
                status: 'rejected',
                rejection_reason: reason
            })
        });
        
        const res = await response.json();
        if (response.ok) {
            showToast("ปฏิเสธคำขอลางานเรียบร้อยแล้ว", "success");
            closeRejectModal();
            fetchLeaves();
        } else {
            showToast(res.error || "เกิดข้อผิดพลาดในการดำเนินรายการ", "danger");
        }
    } catch (e) {
        showToast("เชื่อมต่อเซิร์ฟเวอร์ล้มเหลว", "danger");
    }
}

// Handle Submit Leave Requests (including Base64 attachments and Signed Token)
async function handleLeaveSubmit(event, formType) {
    event.preventDefault();
    const token = localStorage.getItem('authToken');
    
    let leaveType, startDate, endDate, leavePeriod, reason, fileInput;
    
    if (formType === 'quick') {
        leaveType = document.getElementById('quick-leave-type').value;
        startDate = document.getElementById('quick-start-date').value;
        endDate = document.getElementById('quick-end-date').value;
        leavePeriod = document.getElementById('quick-leave-period').value;
        reason = document.getElementById('quick-reason').value;
        fileInput = document.getElementById('quick-attachment');
    } else {
        leaveType = document.getElementById('full-leave-type').value;
        startDate = document.getElementById('full-start-date').value;
        endDate = document.getElementById('full-end-date').value;
        leavePeriod = document.getElementById('full-leave-period').value;
        reason = document.getElementById('full-reason').value;
        fileInput = document.getElementById('full-attachment');
    }
    
    if (!leaveType || !startDate || !endDate) {
        return showToast("กรุณากรอกข้อมูลวันที่และประเภทการลาให้ครบถ้วน", "warning");
    }
    
    let attachmentData = null;
    let attachmentName = null;
    
    if (fileInput && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        attachmentName = file.name;
        try {
            attachmentData = await getBase64(file);
        } catch (e) {
            return showToast("เกิดข้อผิดพลาดในการเปิดไฟล์หลักฐานแนบ", "danger");
        }
    }
    
    try {
        const response = await fetch(`${API_BASE}/leaves`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                leave_type: leaveType,
                start_date: startDate,
                end_date: endDate,
                leave_period: leavePeriod,
                reason: reason,
                attachment_data: attachmentData,
                attachment_name: attachmentName
            })
        });
        
        const result = await response.json();
        if (response.ok) {
            showToast("ยื่นคำขอลางานสำเร็จแล้ว รอการอนุมัติตามขั้นตอน", "success");
            
            document.getElementById('form-quick-leave').reset();
            document.getElementById('form-full-leave').reset();
            toggleDateLock('quick');
            toggleDateLock('full');
            
            fetchProfile();
        } else {
            showToast(result.error || "ไม่สามารถยื่นใบลาได้", "danger");
        }
    } catch (e) {
        showToast("ไม่สามารถเชื่อมต่อระบบเครือข่ายได้", "danger");
    }
}

// Calendar Month Management
function changeMonth(dir) {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + dir);
    renderCalendar();
}

// Render team calendar grid
function renderCalendar() {
    const calendarMonthYear = document.getElementById('calendar-month-year');
    const calendarDays = document.getElementById('calendar-days');
    if (!calendarDays || !calendarMonthYear) return;
    
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    
    calendarMonthYear.innerText = `${THAI_MONTHS[month]} ${year + 543}`;
    
    calendarDays.innerHTML = '';
    
    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const prevTotalDays = new Date(year, month, 0).getDate();
    
    const approvedLeaves = allLeaves.filter(l => l.status === 'approved');
    
    for (let i = firstDayIndex; i > 0; i--) {
        const dayNum = prevTotalDays - i + 1;
        const cell = document.createElement('div');
        cell.className = 'calendar-day calendar-day-other';
        cell.innerHTML = `<span class="calendar-day-num">${dayNum}</span>`;
        calendarDays.appendChild(cell);
    }
    
    const today = new Date();
    
    for (let day = 1; day <= totalDays; day++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day';
        
        if (today.getDate() === day && today.getMonth() === month && today.getFullYear() === year) {
            cell.classList.add('calendar-day-today');
        }
        
        cell.innerHTML = `
            <span class="calendar-day-num">${day}</span>
            <div class="calendar-day-events" id="cal-events-${year}-${month + 1}-${day}"></div>
        `;
        calendarDays.appendChild(cell);
        
        const monthStr = String(month + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        const dateStr = `${year}-${monthStr}-${dayStr}`;
        
        const dayEvents = approvedLeaves.filter(l => {
            const start = l.start_date;
            const end = l.end_date;
            return dateStr >= start && dateStr <= end;
        });
        
        const eventsContainer = cell.querySelector('.calendar-day-events');
        if (dayEvents.length > 0) {
            eventsContainer.innerHTML = dayEvents.map(e => {
                const typeTh = e.leave_type === 'sick' ? 'ป่วย' : (e.leave_type === 'personal' ? 'กิจ' : 'พักร้อน');
                const periodText = e.leave_period === 'full' ? '' : (e.leave_period === 'morning' ? ' (ครึ่งเช้า)' : ' (ครึ่งบ่าย)');
                return `<span class="calendar-day-event event-${e.leave_type}" title="${e.employee_name}: ลา${typeTh}${periodText}">${e.employee_name}: ลา${typeTh}${periodText}</span>`;
            }).join('');
        }
    }
    
    const gridCount = firstDayIndex + totalDays;
    const paddingEnd = 42 - gridCount;
    
    for (let day = 1; day <= paddingEnd; day++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day calendar-day-other';
        cell.innerHTML = `<span class="calendar-day-num">${day}</span>`;
        calendarDays.appendChild(cell);
    }
}

// Render Employee lists on HR page (with Edit entitlement hooks and token)
async function renderHREmployeeStatsTable() {
    const tbody = document.querySelector('#table-hr-employee-stats tbody');
    if (!tbody) return;
    
    const employees = [
        { id: 1, name: 'สมิตา อาสาคติ', dept: 'IT', limits: { sick: 30, personal: 6, vacation: 10 } },
        { id: 2, name: 'กิตติพงษ์ แก้ววิเชียร', dept: 'Marketing', limits: { sick: 30, personal: 6, vacation: 10 } },
        { id: 3, name: 'นรีรัตน์ รักษาพล', dept: 'Sales', limits: { sick: 30, personal: 6, vacation: 10 } },
        { id: 4, name: 'วิชาญ ศรีสมบูรณ์', dept: 'IT', limits: { sick: 30, personal: 6, vacation: 10 } },
        { id: 5, name: 'ประภาส เมืองดี', dept: 'HR', limits: { sick: 30, personal: 6, vacation: 10 } }
    ];
    
    const statsHtml = employees.map(emp => {
        const empLeaves = allLeaves.filter(l => l.employee_name === emp.name && l.status === 'approved');
        
        const used = { sick: 0, personal: 0, vacation: 0 };
        empLeaves.forEach(l => {
            if (used[l.leave_type] !== undefined) {
                used[l.leave_type] += l.leave_duration;
            }
        });
        
        const limits = (currentUser && currentUser.id === emp.id) ? {
            sick: currentUser.sick_leave_limit,
            personal: currentUser.personal_leave_limit,
            vacation: currentUser.vacation_leave_limit
        } : emp.limits;
        
        return `
            <tr>
                <td><strong>${emp.name}</strong></td>
                <td>${emp.dept}</td>
                <td>${used.sick} วัน <span class="text-muted">(เหลือ ${(limits.sick - used.sick).toFixed(1).replace('.0', '')})</span></td>
                <td>${used.personal} วัน <span class="text-muted">(เหลือ ${(limits.personal - used.personal).toFixed(1).replace('.0', '')})</span></td>
                <td>${used.vacation} วัน <span class="text-muted">(เหลือ ${(limits.vacation - used.vacation).toFixed(1).replace('.0', '')})</span></td>
                <td>
                    <button class="btn btn-secondary btn-icon" onclick="openEntitlementsModal(${emp.id}, '${emp.name}', ${limits.sick}, ${limits.personal}, ${limits.vacation})" title="ปรับเปลี่ยนวันลา">
                        <i data-lucide="settings" style="width:16px;height:16px;"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    
    tbody.innerHTML = statsHtml;
    lucide.createIcons();
}

// Edit custom entitlements modals
function openEntitlementsModal(userId, name, sick, personal, vacation) {
    document.getElementById('entitlements-user-id').value = userId;
    document.getElementById('entitlements-user-name').value = name;
    document.getElementById('entitlements-sick-limit').value = sick;
    document.getElementById('entitlements-personal-limit').value = personal;
    document.getElementById('entitlements-vacation-limit').value = vacation;
    
    document.getElementById('entitlements-modal').classList.add('active');
}

function closeEntitlementsModal() {
    document.getElementById('entitlements-modal').classList.remove('active');
}

async function submitEntitlements() {
    const userId = document.getElementById('entitlements-user-id').value;
    const sick = parseInt(document.getElementById('entitlements-sick-limit').value);
    const personal = parseInt(document.getElementById('entitlements-personal-limit').value);
    const vacation = parseInt(document.getElementById('entitlements-vacation-limit').value);
    const token = localStorage.getItem('authToken');
    
    if (isNaN(sick) || isNaN(personal) || isNaN(vacation)) {
        return showToast("กรุณากรอกข้อมูลสิทธิ์ให้เป็นตัวเลข", "warning");
    }
    
    try {
        const response = await fetch(`${API_BASE}/users/update_entitlements`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                user_id: userId,
                sick_limit: sick,
                personal_limit: personal,
                vacation_limit: vacation
            })
        });
        
        const res = await response.json();
        if (response.ok) {
            showToast("อัปเดตสิทธิ์วันลาเรียบร้อยแล้ว", "success");
            closeEntitlementsModal();
            fetchProfile();
        } else {
            showToast(res.error || "เกิดข้อผิดพลาดในการแก้ไขสิทธิ์", "danger");
        }
    } catch (e) {
        showToast("ไม่สามารถอัปเดตข้อมูลได้ในขณะนี้", "danger");
    }
}

// Render HR Dashboards & Chart.js (with Signed Token)
async function renderCharts() {
    const token = localStorage.getItem('authToken');
    if (!token) return;
    
    try {
        const response = await fetch(`${API_BASE}/reports/statistics`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        
        if (!response.ok) return showToast("ดึงสถิติรายงานล้มเหลว", "danger");
        
        const stats = await response.json();
        
        const counts = stats.counts;
        document.getElementById('hr-stat-total').innerText = counts.total_count || 0;
        document.getElementById('hr-stat-pending').innerText = counts.pending_count || 0;
        document.getElementById('hr-stat-approved').innerText = counts.approved_count || 0;
        
        renderHREmployeeStatsTable();
        
        const monthlyData = stats.monthly_stats;
        const months = [...new Set(monthlyData.map(d => d.month))].sort();
        
        const sickData = months.map(m => {
            const match = monthlyData.find(d => d.month === m && d.leave_type === 'sick');
            return match ? match.total_days : 0;
        });
        
        const personalData = months.map(m => {
            const match = monthlyData.find(d => d.month === m && d.leave_type === 'personal');
            return match ? match.total_days : 0;
        });
        
        const vacationData = months.map(m => {
            const match = monthlyData.find(d => d.month === m && d.leave_type === 'vacation');
            return match ? match.total_days : 0;
        });
        
        const monthsLabels = months.map(m => {
            const parts = m.split('-');
            return `${parts[1]}/${parts[0]}`;
        });
        
        if (monthlyChart) monthlyChart.destroy();
        
        const ctxMonthly = document.getElementById('chart-monthly-trend').getContext('2d');
        monthlyChart = new Chart(ctxMonthly, {
            type: 'bar',
            data: {
                labels: monthsLabels,
                datasets: [
                    {
                        label: 'ลาป่วย',
                        data: sickData,
                        backgroundColor: '#ef4444',
                        borderRadius: 4
                    },
                    {
                        label: 'ลากิจ',
                        data: personalData,
                        backgroundColor: '#f59e0b',
                        borderRadius: 4
                    },
                    {
                        label: 'ลาพักร้อน',
                        data: vacationData,
                        backgroundColor: '#2563eb',
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { font: { family: 'Sarabun' } } }
                },
                scales: {
                    x: { stacked: true, grid: { display: false } },
                    y: { stacked: true, beginAtZero: true, title: { display: true, text: 'จำนวนวันลาสะสม' } }
                }
            }
        });
        
        const deptData = stats.department_stats;
        const deptsMap = {};
        deptData.forEach(d => {
            deptsMap[d.department] = (deptsMap[d.department] || 0) + d.total_days;
        });
        
        const depts = Object.keys(deptsMap);
        const deptsValues = Object.values(deptsMap);
        
        if (deptChart) deptChart.destroy();
        
        const ctxDept = document.getElementById('chart-dept-breakdown').getContext('2d');
        deptChart = new Chart(ctxDept, {
            type: 'doughnut',
            data: {
                labels: depts,
                datasets: [{
                    data: deptsValues,
                    backgroundColor: [
                        '#3b82f6', // IT
                        '#8b5cf6', // HR
                        '#ec4899', // Marketing
                        '#10b981', // Sales
                        '#f59e0b'  // Finance
                    ],
                    borderWidth: 2,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { font: { family: 'Sarabun' } } }
                }
            }
        });
        
    } catch (e) {
        console.error(e);
        showToast("เกิดข้อผิดพลาดในการประมวลผลข้อมูลกราฟ", "danger");
    }
}

// Export Report (with Signed Token)
async function exportReportToExcel() {
    const token = localStorage.getItem('authToken');
    if (!token) return;
    
    try {
        const response = await fetch(`${API_BASE}/reports/export`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        
        if (!response.ok) return showToast("ดาวน์โหลดรายงานล้มเหลว", "danger");
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'leave_report.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showToast("ส่งออกข้อมูลเป็น CSV สำเร็จแล้ว", "success");
    } catch (e) {
        showToast("เกิดข้อผิดพลาดในการส่งออกไฟล์", "danger");
    }
}

// Handle Login Form Submission (Stores Signed Token)
async function handleLogin(event) {
    event.preventDefault();
    const userEl = document.getElementById('login-username');
    const passEl = document.getElementById('login-password');
    
    const username = userEl.value.trim();
    const password = passEl.value;
    
    if (!username || !password) {
        return showToast("กรุณากรอกข้อมูลให้ครบถ้วน", "warning");
    }
    
    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        if (response.ok) {
            // Save Secure Cryptographic Token
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userId', data.id);
            showToast(`ยินดีต้อนรับคุณ ${data.name}`, "success");
            
            userEl.value = '';
            passEl.value = '';
            
            navigateTo('dashboard');
        } else {
            showToast(data.error || "เข้าสู่ระบบไม่สำเร็จ", "danger");
        }
    } catch (error) {
        console.error(error);
        showToast("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้", "danger");
    }
}

// Handle Registration Form Submission (Stores Signed Token)
async function handleRegister(event) {
    event.preventDefault();
    const name = document.getElementById('register-name').value.trim();
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    const department = document.getElementById('register-department').value;
    const role = document.getElementById('register-role').value;
    
    if (!name || !username || !password || !department || !role) {
        return showToast("กรุณากรอกข้อมูลลงทะเบียนให้ครบถ้วน", "warning");
    }
    
    try {
        const response = await fetch(`${API_BASE}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, username, password, department, role })
        });
        
        const data = await response.json();
        if (response.ok) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userId', data.id);
            showToast("สมัครสมาชิกและเข้าสู่ระบบสำเร็จ", "success");
            
            document.getElementById('form-register').reset();
            
            navigateTo('dashboard');
        } else {
            showToast(data.error || "ลงทะเบียนไม่สำเร็จ", "danger");
        }
    } catch (error) {
        console.error(error);
        showToast("เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์", "danger");
    }
}

// Handle Logout
function handleLogout() {
    if (confirm("คุณแน่ใจหรือไม่ว่าต้องการออกจากระบบ?")) {
        localStorage.removeItem('authToken');
        localStorage.removeItem('userId');
        showToast("ออกจากระบบสำเร็จแล้ว", "success");
        navigateTo('landing');
    }
}
