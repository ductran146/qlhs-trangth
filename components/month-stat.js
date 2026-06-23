import { Store, fmtMoney, todayStr } from '../shared/store.js';

function isTaughtOrMakeup(s) {
  return s.status === 'taught' || s.status === 'makeup' || s.status === 'partial';
}
function actualSlots(s) {
  return Number(s.actualSlots ?? s.plannedSlots ?? s.duration ?? 1);
}
function formatNumber(n) {
  return Number(n).toLocaleString('vi-VN');
}
function formatToday(d) {
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function _draw(el) {
  const students = Store.get('students');
  const sessions = Store.get('sessions');
  const debts    = (Store.get('debts') || []).filter(d => !d.done);

  const now   = new Date();
  const today = todayStr();
  const year  = now.getFullYear();
  const month = now.getMonth();
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const label = `Tháng ${month + 1}/${year}`;

  const monthSessions = sessions.filter(s => s.date >= start && s.date <= today);
  const taught = monthSessions.filter(isTaughtOrMakeup);

  const totalSlots  = taught.reduce((sum, s) => sum + actualSlots(s), 0);
  const totalIncome = taught.reduce((sum, sess) => {
    const st = students.find(s => s.id === sess.studentId);
    return sum + ((st?.feePerSlot || sess.feePerSlot || 0) * actualSlots(sess));
  }, 0);
  const debtSlots   = debts.reduce((sum, d) => sum + Number(d.slots || 0), 0);

  // Ca chưa chấm: đếm ô lịch có học trong tháng này (đến hôm nay) mà chưa có session record hoặc status pending
  // Giống cách tính của week-attendance để nhất quán
  const sessionMap = {};
  sessions.forEach(s => { sessionMap[`${s.studentId}_${s.date}`] = s; });

  let pendingCount = 0;
  const activeStudents = students.filter(s => s.status !== 'stopped');

  // Duyệt từng ngày trong tháng đến hôm nay
  const mStartDate = new Date(year, month, 1);
  const todayDate  = new Date();
  for (let d = new Date(mStartDate); d <= todayDate; d.setDate(d.getDate() + 1)) {
    const dow     = d.getDay();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    for (const st of activeStudents) {
      if (!(st.schedDays || []).includes(dow)) continue;
      if (st.startDate && dateStr < st.startDate) continue;
      const sess = sessionMap[`${st.id}_${dateStr}`];
      if (!sess || !sess.status || sess.status === 'pending') pendingCount++;
    }
  }

  const activeStudentCount = students.filter(s => s.status !== 'stopped').length;

  el.innerHTML = `
    <section class="month-stat-section" aria-label="Tổng quan tháng này">
      <div class="month-overview-head">
        <div>
          <div class="section-label">Tổng quan tháng này</div>
          <h2>${label}</h2>
          <p>Tính đến hôm nay · ${formatToday(now)}</p>
        </div>
      </div>
      <div class="month-stat-grid">
        <div class="month-stat-card violet">
          <div class="month-stat-value">${activeStudentCount}</div>
          <div class="month-stat-label">Bé đang dạy</div>
        </div>
        <div class="month-stat-card green">
          <div class="month-stat-value">${formatNumber(totalSlots)}</div>
          <div class="month-stat-label">Ca đã học</div>
        </div>
        <div class="month-stat-card blue">
          <div class="month-stat-value">${formatNumber(pendingCount)}</div>
          <div class="month-stat-label">Ca chưa chấm</div>
        </div>
        <div class="month-stat-card red">
          <div class="month-stat-value">${formatNumber(debtSlots)}</div>
          <div class="month-stat-label">Ca còn nợ</div>
        </div>
        <div class="month-stat-card amber">
          <div class="month-stat-value">${fmtMoney(totalIncome)}</div>
          <div class="month-stat-label">Thu nhập tạm tính</div>
        </div>
      </div>
    </section>`;
}

export function render(el) {
  _draw(el);
  Store.subscribe('sessions', () => _draw(el));
  Store.subscribe('students', () => _draw(el));
  Store.subscribe('debts',    () => _draw(el));
}
